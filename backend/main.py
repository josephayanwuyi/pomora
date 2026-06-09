import sqlite3
import bcrypt
import jwt
import datetime
import os
import psycopg2

#
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

app = FastAPI(title="Pomora Backend API")

# --- CORS SECURITY POLICY ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permits all client browser endpoints to negotiate payloads
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SECURITY SYSTEM CONFIGURATION ---
JWT_SECRET = "CHANGE_THIS_TO_A_COMPLEX_RANDOM_STRING_SECRET_KEY"
JWT_ALGORITHM = "HS256"
security_bearer = HTTPBearer()

# --- DATABASE INITIALIZER ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///pomora.db")

def get_db_connection():
    """Dynamically routes traffic to cloud Postgres or local SQLite."""
    # FIXED: Check if 'postgres' is anywhere in the string to be absolutely bulletproof
    if "postgres" in DATABASE_URL:
        # Handles a common Render/Neon legacy string format mismatch safely
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        return psycopg2.connect(url)
    else:
        return sqlite3.connect("pomora.db")

def init_db():
    """Initializes tables using the correct SQL dialect dynamically."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # FIXED: Uniform check for Postgres presence
    is_postgres = "postgres" in DATABASE_URL
    
    # Dynamic column assignment matching the database dialect exactly
    id_auto_increment = "SERIAL PRIMARY KEY" if is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    timestamp_default = "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" if is_postgres else "DATETIME DEFAULT CURRENT_TIMESTAMP"
    
    print(f"--- POMORA DATABASE INITIALIZATION (USING {'POSTGRESQL' if is_postgres else 'SQLITE3'}) ---")
    
    # Users table
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS users (
            id {id_auto_increment},
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            pomo_time INTEGER DEFAULT 25,
            short_time INTEGER DEFAULT 5,
            long_time INTEGER DEFAULT 15,
            long_interval INTEGER DEFAULT 4,
            auto_break INTEGER DEFAULT 0,
            auto_pomo INTEGER DEFAULT 0,
            selected_sound TEXT DEFAULT 'digital-alarm-buzzer'
        )
    """)
    
    # Tasks table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Analytics logs table
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS analytics_logs (
            id {id_auto_increment},
            user_id INTEGER NOT NULL,
            task_text TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            timestamp {timestamp_default},
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    
    conn.commit()
    conn.close()

init_db()

# --- CRYPTOGRAPHY & TOKEN HELPERS ---
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except ValueError:
        return False

def create_access_token(user_id: int, name: str, email: str) -> str:
    """Generates an encrypted JWT token valid for 7 days."""
    payload = {
        "user_id": user_id,
        "name": name,
        "email": email,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(credentials: HTTPAuthorizationCredentials = Depends(security_bearer)) -> dict:
    """Dependency guard that validates incoming headers and drops unauthenticated access."""
    token = credentials.credentials
    try:
        decoded_payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return decoded_payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session signature token authorization denied.")

# --- DATA VALIDATION SCHEMAS ---
class UserSignUp(BaseModel):
    name: str
    email: EmailStr
    password: str

class UserSignIn(BaseModel):
    email: EmailStr
    password: str

class TaskCreate(BaseModel):
    id: str
    text: str

class SettingsUpdate(BaseModel):
    pomo_time: int
    short_time: int
    long_time: int
    long_interval: int
    auto_break: bool
    auto_pomo: bool
    selected_sound: str

class AnalyticsLogCreate(BaseModel):
    task_text: str
    duration_minutes: int

# --- API ROUTE ENDPOINTS ---

@app.post("/api/signup")
def signup(user: UserSignUp):
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE email = ?", (user.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="This email is already registered.")
        
        secure_password = hash_password(user.password)
        cursor.execute(
            "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
            (user.name, user.email, secure_password)
        )
        conn.commit()
        return {"status": "success", "message": "Account created successfully! 🎉"}
    finally:
        conn.close()

@app.post("/api/signin")
def signin(credentials: UserSignIn):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # FIXED: Explicitly pull named columns so Postgres never guesses row positions
    cursor.execute("""
        SELECT id, name, email, password, pomo_time, short_time, long_time, 
               long_interval, auto_break, auto_pomo, selected_sound 
        FROM users WHERE email = %s
    """, (credentials.email,))
    
    user_record = cursor.fetchone()
    conn.close()
    
    if not user_record:
        raise HTTPException(status_code=401, detail="Invalid email address or password.")
        
    # Mapping fields safely by index alignment properties
    user_id = user_record[0]
    name = user_record[1]
    email = user_record[2]
    stored_hash = user_record[3]
    pomo = user_record[4]
    short = user_record[5]
    long_b = user_record[6]
    interval = user_record[7]
    auto_b = user_record[8]
    auto_p = user_record[9]
    sound = user_record[10]
    
    if not verify_password(credentials.password, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid email address or password.")
        
    # Generate a cryptographically signed security token string
    token_str = create_access_token(user_id, name, email)
        
    return {
        "status": "success",
        "message": f"Welcome back, {name}!",
        "token": token_str,
        "user": {
            "name": name,
            "email": email,
            "config": {
                "durations": {"pomodoro": pomo, "short": short, "long": long_b},
                "longBreakInterval": interval,
                "autoStartBreaks": bool(auto_b),
                "autoStartPomodoros": bool(auto_p),
                "selectedSound": sound
            }
        }
    }
# --- SECURED ENDPOINTS (Require Verified Token to Run) ---

@app.get("/api/tasks")
def get_tasks(token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"] # Extracted securely out of the verified token payload
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    cursor.execute("SELECT id, text, completed FROM tasks WHERE user_id = ?", (user_id,))
    records = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "text": r[1], "completed": bool(r[2])} for r in records]

@app.post("/api/tasks")
def add_task(task: TaskCreate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO tasks (id, user_id, text, completed) VALUES (?, ?, ?, 0)",
            (task.id, user_id, task.text)
        )
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

@app.delete("/api/tasks/{task_id}")
def delete_task_backend(task_id: str, token_data: dict = Depends(verify_jwt_token)):
    # Verify ownership before executing deletion actions
    user_id = token_data["user_id"]
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/tasks/toggle/{task_id}")
def toggle_task_backend(task_id: str, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    cursor.execute("SELECT completed FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
    record = cursor.fetchone()
    if record:
        new_status = 0 if record[0] == 1 else 1
        cursor.execute("UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?", (new_status, task_id, user_id))
        conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/settings/save")
def save_user_settings(data: SettingsUpdate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    
    auto_break_int = 1 if data.auto_break else 0
    auto_pomo_int = 1 if data.auto_pomo else 0
    
    try:
        cursor.execute("""
            UPDATE users SET 
                pomo_time = ?, short_time = ?, long_time = ?, 
                long_interval = ?, auto_break = ?, auto_pomo = ?, selected_sound = ?
            WHERE id = ?
        """, (data.pomo_time, data.short_time, data.long_time, data.long_interval, 
              auto_break_int, auto_pomo_int, data.selected_sound, user_id))
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Database write error failure.")
    finally:
        conn.close()


@app.post("/api/analytics/log")
def log_focus_session(data: AnalyticsLogCreate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO analytics_logs (user_id, task_text, duration_minutes)
            VALUES (?, ?, ?)
        """, (user_id, data.task_text, data.duration_minutes))
        conn.commit()
        return {"status": "success", "message": "Focus interval logged successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to write analytics data log.")
    finally:
        conn.close()


@app.get("/api/analytics/dashboard")
def get_dashboard_analytics(range_type: str = "7days", token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = sqlite3.connect("pomora.db")
    cursor = conn.cursor()
    
    # Define SQL Date Filter dynamically based on user timeframe selection
    if range_type == "7days":
        date_filter = "date('now', '-7 days')"
    elif range_type == "30days":
        date_filter = "date('now', '-30 days')"
    elif range_type == "1year":
        date_filter = "date('now', '-365 days')"
    else:
        date_filter = "date('now', '-7 days')"

    # Query 1: Fetch total focus minutes grouped by individual days for the trend graph
    cursor.execute(f"""
        SELECT date(timestamp) as focus_date, SUM(duration_minutes) 
        FROM analytics_logs 
        WHERE user_id = ? AND date(timestamp) >= {date_filter}
        GROUP BY focus_date
        ORDER BY focus_date ASC
    """, (user_id,))
    daily_trends = [{"date": r[0], "minutes": r[1]} for r in cursor.fetchall()]

    # Query 2: Top focused tasks distribution list
    cursor.execute(f"""
        SELECT task_text, COUNT(*) as cycles 
        FROM analytics_logs 
        WHERE user_id = ? AND date(timestamp) >= {date_filter}
        GROUP BY task_text
        ORDER BY cycles DESC LIMIT 5
    """, (user_id,))
    top_tasks = [{"task": r[0], "cycles": r[1]} for r in cursor.fetchall()]

    # Query 3: General lifetime overview cards parameters
    cursor.execute("SELECT SUM(duration_minutes) FROM analytics_logs WHERE user_id = ?", (user_id,))
    total_lifetime_mins = cursor.fetchone()[0] or 0

    conn.close()

    return {
        "range_selected": range_type,
        "daily_trends": daily_trends,
        "top_tasks": top_tasks,
        "summary": {
            "total_hours": round(total_lifetime_mins / 60, 1),
            "streak_days": len(daily_trends) # Rough calculation based on active days
        }
    }