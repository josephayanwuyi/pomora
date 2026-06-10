import sqlite3
import bcrypt
import jwt
import datetime
import os
import psycopg2
import requests

from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

app = FastAPI(title="Pomora Backend API")

# --- CORS SECURITY POLICY ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SECURITY SYSTEM CONFIGURATION ---
JWT_SECRET = os.getenv("JWT_SECRET", "a_local_fallback_for_development_only")
JWT_ALGORITHM = "HS256"
security_bearer = HTTPBearer()

# --- DATABASE INITIALIZER ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///pomora.db")
IS_POSTGRES = "postgres" in DATABASE_URL

# --- EMAIL VERIFICATION API ---
RESEND_API_KEY = os.getenv("RESEND_API_KEY")

# frontend URL where users will land to after verification
FRONTEND_URL = "https://pomora-omega.vercel.app"

def get_db_connection():
    # Dynamically routes traffic to cloud Postgres or local SQLite.
    if IS_POSTGRES:
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        return psycopg2.connect(url)
    else:
        return sqlite3.connect("pomora.db")

def init_db():
# Initializes tables using the correct SQL dialect dynamically.
    conn = get_db_connection()
    cursor = conn.cursor()
    
    id_auto_increment = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    timestamp_default = "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" if IS_POSTGRES else "DATETIME DEFAULT CURRENT_TIMESTAMP"
    
    print(f"--- POMORA DATABASE INITIALIZATION (USING {'POSTGRESQL' if IS_POSTGRES else 'SQLITE3'}) ---")
    
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS users (
            id {id_auto_increment},
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_verified INTEGER DEFAULT 0,
            pomo_time INTEGER DEFAULT 25,
            short_time INTEGER DEFAULT 5,
            long_time INTEGER DEFAULT 15,
            long_interval INTEGER DEFAULT 4,
            auto_break INTEGER DEFAULT 0,
            auto_pomo INTEGER DEFAULT 0,
            selected_sound TEXT DEFAULT 'digital-alarm-buzzer'
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

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
    
    try:
        print("Running database schema checks...")
        if IS_POSTGRES:
            # Safely injects the missing verification column if it isn't tracked yet
            cursor.execute("""
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0;
            """)
        else:
            # Fallback tracking rules for local development sqlite storage instances
            cursor.execute("PRAGMA table_info(users);")
            columns = [col[1] for col in cursor.fetchall()]
            if "is_verified" not in columns:
                cursor.execute("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0;")
                
        conn.commit()
        print("Database schema is completely up to date.")
    except Exception as migration_error:
        print(f"Schema status check: {str(migration_error)}")
        conn.rollback() # Safely discard transaction locks if any state drops
    finally:
        cursor.close()
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
    payload = {
        "user_id": user_id,
        "name": name,
        "email": email,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(credentials: HTTPAuthorizationCredentials = Depends(security_bearer)) -> dict:
    token = credentials.credentials
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE email = %s", (user.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="This email is already registered.")
        
        secure_password = hash_password(user.password)
        
        # Insert user with is_verified set to 0 (default)
        cursor.execute(
            "INSERT INTO users (name, email, password, is_verified) VALUES (%s, %s, %s, 0) RETURNING id",
            (user.name, user.email, secure_password)
        )
        user_id = cursor.fetchone()[0]
        conn.commit()
        
        # Generate a simple confirmation token string using their encrypted password hash slice
        verification_token = secure_password[-15:].replace("/", "").replace(".", "")
        verification_link = f"{FRONTEND_URL}/verify.html?email={user.email}&token={verification_token}"
        
        # Fire the verification email out via Resend API
        if RESEND_API_KEY:
            requests.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "from": "Pomora App <onboarding@pomora.app>",
                    "to": [user.email],
                    "subject": "Activate Your Pomora Account",
                    "html": f"""
                        <h3>Welcome to Pomora, {user.name}!</h3>
                        <p>Please click the secure link below to verify your email address and activate your production dashboard profile:</p>
                        <p><a href="{verification_link}" style="background:#c15b5b; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; display:inline-block;">Verify My Email</a></p>
                        <br>
                        <small>If you did not sign up for this account, please ignore this email.</small>
                    """
                }
            )
            
        return {"status": "success", "message": "Account created! Please check your email inbox to verify."}
    finally:
        cursor.close()
        conn.close()

# --- NEW ENDPOINT: HANDLES THE LINK CLICK ---
@app.get("/api/verify")
def verify_email(email: str, token: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT password, is_verified FROM users WHERE email = %s", (email,))
        record = cursor.fetchone()
        
        if not record:
            raise HTTPException(status_code=404, detail="User account records not found.")
            
        stored_hash, is_verified = record
        expected_token = stored_hash[-15:].replace("/", "").replace(".", "")
        
        if token != expected_token:
            raise HTTPException(status_code=400, detail="Invalid or expired verification session signature.")
            
        # Flip the bits to active status 1
        cursor.execute("UPDATE users SET is_verified = 1 WHERE email = %s", (email,))
        conn.commit()
        return {"status": "success", "message": "Account verified successfully!"}
    finally:
        cursor.close()
        conn.close()

@app.post("/api/signin")
def signin(credentials: UserSignIn):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, name, email, password, is_verified, pomo_time, short_time, long_time, 
               long_interval, auto_break, auto_pomo, selected_sound 
        FROM users WHERE email = %s
    """, (credentials.email,))
    
    user_record = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if not user_record:
        raise HTTPException(status_code=401, detail="Invalid email address or password.")
        
    # FIXED: Added 'is_verified' right after stored_hash to match the exact 12-column SQL order
    user_id, name, email, stored_hash, is_verified, pomo, short, long_b, interval, auto_b, auto_p, sound = user_record
    
    if not verify_password(credentials.password, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid email address or password.")
    
    # FIXED: Using the correctly unpacked 'is_verified' variable to block unactivated links
    if not is_verified:
        raise HTTPException(status_code=403, detail="Please verify your email address before logging in.")

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
# --- SECURED ENDPOINTS ---

@app.get("/api/tasks")
def get_tasks(token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()  # FIXED
    cursor = conn.cursor()
    cursor.execute("SELECT id, text, completed FROM tasks WHERE user_id = %s", (user_id,))
    records = cursor.fetchall()
    cursor.close()
    conn.close()
    return [{"id": r[0], "text": r[1], "completed": bool(r[2])} for r in records]

@app.post("/api/tasks")
def add_task(task: TaskCreate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO tasks (id, user_id, text, completed) VALUES (%s, %s, %s, 0)",
            (task.id, user_id, task.text)
        )
        conn.commit()
        return {"status": "success"}
    finally:
        cursor.close()
        conn.close()

@app.delete("/api/tasks/{task_id}")
def delete_task_backend(task_id: str, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE id = %s AND user_id = %s", (task_id, user_id))
    conn.commit()
    cursor.close()
    conn.close()
    return {"status": "success"}


@app.put("/api/tasks/toggle/{task_id}")
def toggle_task_backend(task_id: str, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT completed FROM tasks WHERE id = %s AND user_id = %s", (task_id, user_id))
    record = cursor.fetchone()
    if record:
        new_status = 0 if record[0] == 1 else 1
        cursor.execute("UPDATE tasks SET completed = %s WHERE id = %s AND user_id = %s", (new_status, task_id, user_id))
        conn.commit()
    cursor.close()
    conn.close()
    return {"status": "success"}

@app.post("/api/settings/save")
def save_user_settings(data: SettingsUpdate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    
    auto_break_int = 1 if data.auto_break else 0
    auto_pomo_int = 1 if data.auto_pomo else 0
    
    try:
        cursor.execute("""
            UPDATE users SET 
                pomo_time = %s, short_time = %s, long_time = %s, 
                long_interval = %s, auto_break = %s, auto_pomo = %s, selected_sound = %s
            WHERE id = %s
        """, (data.pomo_time, data.short_time, data.long_time, data.long_interval, 
              auto_break_int, auto_pomo_int, data.selected_sound, user_id))
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Database write error failure.")
    finally:
        cursor.close()
        conn.close()


@app.post("/api/analytics/log")
def log_focus_session(data: AnalyticsLogCreate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO analytics_logs (user_id, task_text, duration_minutes)
            VALUES (%s, %s, %s)
        """, (user_id, data.task_text, data.duration_minutes))
        conn.commit()
        return {"status": "success", "message": "Focus interval logged successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to write analytics data log.")
    finally:
        cursor.close()
        conn.close()

@app.get("/api/analytics/dashboard")
def get_dashboard_analytics(range_type: str = "7days", token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()  # FIXED
    cursor = conn.cursor()
    
    # FIXED: Handled the structural date filter math differences between SQLite and Postgres
    if IS_POSTGRES:
        if range_type == "7days": date_filter = "CURRENT_DATE - INTERVAL '7 days'"
        elif range_type == "30days": date_filter = "CURRENT_DATE - INTERVAL '30 days'"
        elif range_type == "1year": date_filter = "CURRENT_DATE - INTERVAL '1 year'"
        else: date_filter = "CURRENT_DATE - INTERVAL '7 days'"
        
        query_trend = f"""
            SELECT timestamp::date as focus_date, SUM(duration_minutes) 
            FROM analytics_logs 
            WHERE user_id = %s AND timestamp >= {date_filter}
            GROUP BY focus_date ORDER BY focus_date ASC
        """
        query_tasks = f"""
            SELECT task_text, COUNT(*) as cycles 
            FROM analytics_logs 
            WHERE user_id = %s AND timestamp >= {date_filter}
            GROUP BY task_text ORDER BY cycles DESC LIMIT 5
        """
    else:
        if range_type == "7days": date_filter = "date('now', '-7 days')"
        elif range_type == "30days": date_filter = "date('now', '-30 days')"
        elif range_type == "1year": date_filter = "date('now', '-365 days')"
        else: date_filter = "date('now', '-7 days')"
        
        query_trend = f"""
            SELECT date(timestamp) as focus_date, SUM(duration_minutes) 
            FROM analytics_logs 
            WHERE user_id = %s AND date(timestamp) >= {date_filter}
            GROUP BY focus_date ORDER BY focus_date ASC
        """
        query_tasks = f"""
            SELECT task_text, COUNT(*) as cycles 
            FROM analytics_logs 
            WHERE user_id = %s AND date(timestamp) >= {date_filter}
            GROUP BY task_text ORDER BY cycles DESC LIMIT 5
        """

    cursor.execute(query_trend, (user_id,))
    daily_trends = [{"date": str(r[0]), "minutes": r[1]} for r in cursor.fetchall()]

    cursor.execute(query_tasks, (user_id,))
    top_tasks = [{"task": r[0], "cycles": r[1]} for r in cursor.fetchall()]

    cursor.execute("SELECT SUM(duration_minutes) FROM analytics_logs WHERE user_id = %s", (user_id,))
    total_lifetime_mins = cursor.fetchone()[0] or 0

    cursor.close()
    conn.close()

    return {
        "range_selected": range_type,
        "daily_trends": daily_trends,
        "top_tasks": top_tasks,
        "summary": {
            "total_hours": round(total_lifetime_mins / 60, 1),
            "streak_days": len(daily_trends)
        }
    }

# --- GLOBAL 404 REROUTE EXCEPTION HANDLER ---
@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 404:
        # Dynamic link points straight to your production frontend Vercel home address
        FRONTEND_HOME_URL = "https://pomora-omega.vercel.app"
        
        html_content = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Page Not Found | Pomora</title>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

  <link rel="apple-touch-icon" sizes="180x180" href="./assets/img/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="50x50" href="./assets/img/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="./assets/img/favicon-16x16.png">
  <link rel="manifest" href="./assets/img/site.webmanifest">
            <style>
                body {{
                    background-color: #fcf8f2;
                    color: #4a4a4a;
                    font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
    "Segoe UI Symbol";
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    text-align: center;
                }}
                .error-container {{
                    max-width: 500px;
                    padding: 40px;
                    background: #ffffff;
                    border-radius: 16px;
                    box-shadow: 0 8px 24px rgba(184, 115, 99, 0.06);
                    border: 1px solid rgba(184, 115, 99, 0.1);
                }}
                h1 {{
                    font-size: 72px;
                    margin: 0;
                    color: #b87363; /* Matches your premium terracotta focus theme color */
                    font-weight: 800;
                    line-height: 1;
                }}
                h2 {{
                    font-size: 24px;
                    margin: 10px 0 20px 0;
                    color: #333333;
                }}
                p {{
                    font-size: 16px;
                    color: #7a7a7a;
                    line-height: 1.6;
                    margin-bottom: 30px;
                }}
                .home-btn {{
                    display: inline-block;
                    background-color: #b87363;
                    color: #ffffff;
                    text-decoration: none;
                    padding: 14px 28px;
                    font-weight: 600;
                    border-radius: 8px;
                    box-shadow: 0 4px 0px #965647;
                    transition: all 0.1s ease-in-out;
                }}
                .home-btn:active {{
                    transform: translateY(4px);
                    box-shadow: none;
                }}
            </style>
        </head>
        <body>
            <div class="error-container">
                <h1>404</h1>
                <h2>Lost in focus?</h2>
                <p>The page, configuration setup, or data route you are searching for has drifted away or doesn't exist anymore.</p>
                <a href="{FRONTEND_HOME_URL}" class="home-btn">Return to Dashboard</a>
            </div>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content, status_code=404)

    # Maintain default fallback responses for validation lapses or permission errors
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )