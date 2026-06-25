import os
import sqlite3
import datetime
import smtplib
import bcrypt
import jwt
import psycopg2
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from dotenv import load_dotenv

# --- INITIALIZE CORE APPLICATION CONFIGURATIONS ---
load_dotenv()
app = FastAPI(title="Pomora Backend API")

# --- CORS SECURITY POLICY ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION CONSTANTS FROM ENV ---
JWT_SECRET = os.getenv("JWT_SECRET", "a_local_fallback_for_development_only")
JWT_ALGORITHM = "HS256"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5500/frontend")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///pomora.db")

# --- PRODUCTION MAIL CONFIGURATION VARIABLES ---
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_SENDER = os.getenv("SMTP_SENDER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")

# --- INITIALIZE SECURITY COMPONENT LAYER ---
security_bearer = HTTPBearer()
IS_POSTGRES = "postgres" in DATABASE_URL



#  DATABASE ARCHITECTURE CORE ENGINE

def get_db_connection():
    """Dynamically routes traffic to cloud Postgres or local SQLite."""
    if IS_POSTGRES:
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        return psycopg2.connect(url)
    else:
        return sqlite3.connect("pomora.db")

def get_db_placeholder() -> str:
    """Returns correct variable placeholder token injection string per dialect."""
    return "%s" if IS_POSTGRES else "?"

def init_db():
    """Initializes tables dynamically using the correct SQL dialect syntax."""
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
        if IS_POSTGRES:
            cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0;")
        else:
            cursor.execute("PRAGMA table_info(users);")
            columns = [col[1] for col in cursor.fetchall()]
            if "is_verified" not in columns:
                cursor.execute("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0;")
                
        conn.commit()
        print("Database schema setup completed successfully.")
    except Exception as migration_error:
        print(f"Schema migration checkpoint error skipped: {str(migration_error)}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

init_db()


#  CRYPTOGRAPHY, VALIDATION, AND SECURITY TOKENS HELPERS

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


# --- PYDANTIC VALIDATION MODELS ---
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



#  AUTHENTICATION MANAGEMENT GATEWAY ENDPOINTS
@app.post("/api/signup")
def signup(user: UserSignUp):
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    try:
        # 1. Thread-safe unique email validation check
        cursor.execute(f"SELECT id FROM users WHERE email = {p}", (user.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="This email is already registered.")
        
        # 2. Convert incoming credentials into a secure crypt-hash slice string
        secure_password = hash_password(user.password)
        
        # 3. Commit user record to database (Default: Unverified status)
        cursor.execute(
            f"INSERT INTO users (name, email, password, is_verified) VALUES ({p}, {p}, {p}, 0) RETURNING id" if IS_POSTGRES else
            f"INSERT INTO users (name, email, password, is_verified) VALUES ({p}, {p}, {p}, 0)",
            (user.name, user.email, secure_password)
        )
        user_id = cursor.fetchone()[0] if IS_POSTGRES else cursor.lastrowid
        conn.commit()
        
        # 4. Generate dynamic registration verification parameters
        verification_token = secure_password[-15:].replace("/", "").replace(".", "")
        verification_link = f"{FRONTEND_URL}/verify.html?email={user.email}&token={verification_token}"
        
        html_template = f"""
            <div style="font-family: sans-serif; background-color: #fcf8f2; padding: 30px; text-align: center;">
                <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; border: 1px solid #b87363; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                    <h3 style="color: #b87363; margin-top: 0; font-size: 20px;">Welcome to Pomora, {user.name}</h3>
                    <p style="color: #4a4a4a; font-size: 15px; line-height: 1.6;">
                        Please click the secure link below to verify your email address and activate your production dashboard profile:
                    </p>
                    <p style="margin: 30px 0;">
                        <a href="{verification_link}" style="background:#b87363; color:white; padding:12px 24px; text-decoration:none; border-radius:8px; font-weight: bold; display:inline-block;">
                            Verify My Email
                        </a>
                    </p>
                    <br>
                    <small style="color: #7a7a7a;">If you did not sign up for this account, please ignore this email.</small>
                </div>
            </div>
        """
        
        # ==========================================================================
        #  PRODUCTION ENGINE: MAILJET OUTBOUND DISPATCH (SIGNUP ACTIVATION)
        # ==========================================================================
        mj_key = os.environ.get("MAILJET_API_KEY")
        mj_secret = os.environ.get("MAILJET_SECRET_KEY")
        mj_sender = os.environ.get("SMTP_SENDER")

        if mj_key and mj_secret and mj_sender:
            mailjet_url = "https://api.mailjet.com/v3.1/send"
            
            payload = {
                "Messages": [
                    {
                        "From": {"Email": mj_sender, "Name": "Pomora App"},
                        "To": [{"Email": user.email, "Name": user.name}],
                        "Subject": "Activate Your Pomora Account",
                        "HTMLPart": html_template
                    }
                ]
            }
            
            try:
                # Dispatched over port 443 HTTPS endpoint - Render passes this instantly!
                response = requests.post(mailjet_url, json=payload, auth=(mj_key, mj_secret), timeout=8)
                if response.status_code == 200:
                    print(f"Verification email successfully delivered via Mailjet API to {user.email}")
                else:
                    print(f"Mailjet API Rejection: {response.status_code} - {response.text}")
            except Exception as mail_network_err:
                print(f"Mailjet signup gateway edge connection timeout: {str(mail_network_err)}")
        
        return {"status": "success", "message": "Account created! Please check your email inbox to verify."}
        
    except Exception as general_err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error: {str(general_err)}")
    finally:
        cursor.close()
        conn.close()


@app.get("/api/verify")
def verify_account(email: str, token: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    try:
        # 1. Fetch user records to validate token sequences and grab the registered name
        cursor.execute(f"SELECT id, name, password, is_verified FROM users WHERE email = {p}", (email,))
        user_record = cursor.fetchone()
        
        if not user_record:
            raise HTTPException(status_code=404, detail="Account profile not found.")
            
        user_id, user_name, secure_password, is_verified = user_record
        
        if is_verified == 1:
            return {"status": "success", "message": "Account already active. Log in to continue.", "user_name": user_name}
            
        expected_token = secure_password[-15:].replace("/", "").replace(".", "")
        if token != expected_token:
            raise HTTPException(status_code=400, detail="Invalid or expired verification token parameters.")
            
        # 2. Activate user record state within your PostgreSQL or SQLite core storage row
        cursor.execute(f"UPDATE users SET is_verified = 1 WHERE id = {p}", (user_id,))
        conn.commit()
        
        # 3. Compile an authentic responsive founder onboarding content template layout
        walkthrough_html = f"""
            <div style="font-family: sans-serif; background-color: #fcf8f2; padding: 40px 15px; color: #4a4a4a;">
                <div style="max-width: 550px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; border: 1px solid rgba(184, 115, 99, 0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
                    <h3 style="color: #b87363; margin-top: 0; font-size: 22px;">Hey {user_name}, welcome to Pomora! 👋</h3>
                    <p style="font-size: 15px; line-height: 1.6;">
                        Your account is officially active! I built Pomora because as a student, managing deep work focus blocks while trying to balance an elite academic performance is incredibly demanding. This app is designed to streamline your daily tasks and automate your workflow intervals so you can hit your highest targets efficiently.
                    </p>
                    <h4 style="color: #333333; margin-bottom: 8px; font-size: 16px;">Quick Walkthrough to Get Started:</h4>
                    <ul style="padding-left: 20px; font-size: 14px; line-height: 1.6; margin-top: 0;">
                        <li style="margin-bottom: 8px;"><strong>Organize Your Sprint:</strong> Head to your task manager card right below the clock and list out your immediate assignments or features.</li>
                        <li style="margin-bottom: 8px;"><strong>The 25-Minute Rule:</strong> Hit the start button. Avoid switching tabs or picking up distractions until the digital alarm buzzer signals your break.</li>
                        <li style="margin-bottom: 8px;"><strong>Seamless Syncing:</strong> Since your account is verified, you can log in from your laptop, phone, or tablet and your tasks will always be securely tracked in real time.</li>
                    </ul>
                    <p style="font-size: 15px; line-height: 1.6;"> Put in the work, trust your focus routines, and let's go make that 5.0 GPA goal an absolute reality. </p>
                    <div style="margin: 35px 0 20px 0; border-top: 1px solid #eeeeee; padding-top: 20px;">
                        <p style="margin: 0; font-weight: bold; color: #333333; font-size: 15px;">With ❤️ Joseph Ayanwuyi,</p>
                        <p style="margin: 4px 0 0 0; color: #7a7a7a; font-size: 13px;">Creative Director & Founder, Pomora</p>
                    </div>
                </div>
            </div>
        """
        
        
        #  PRODUCTION ENGINE: MAILJET OUTBOUND DISPATCH (FOUNDER ONBOARDING WELCOME)
        mj_key = os.environ.get("MAILJET_API_KEY")
        mj_secret = os.environ.get("MAILJET_SECRET_KEY")
        mj_sender = os.environ.get("SMTP_SENDER")

        if mj_key and mj_secret and mj_sender:
            mailjet_url = "https://api.mailjet.com/v3.1/send"
            
            payload = {
                "Messages": [
                    {
                        "From": {"Email": mj_sender, "Name": "Joseph (Founder, Pomora)"},
                        "To": [{"Email": email, "Name": user_name}],
                        "Subject": "Welcome to Pomora! (Quick App Walkthrough)",
                        "HTMLPart": walkthrough_html
                    }
                ]
            }
            
            try:
                # API call securely clears cloud firewalls instantly
                response = requests.post(mailjet_url, json=payload, auth=(mj_key, mj_secret), timeout=8)
                if response.status_code == 200:
                    print(f"Onboarding walkthrough email successfully delivered via Mailjet API to {email}")
                else:
                    print(f"Mailjet Onboarding API Rejection: {response.status_code} - {response.text}")
            except Exception as walkthrough_mail_err:
                print(f"Mailjet onboarding gateway connection timeout: {str(walkthrough_mail_err)}")
                
        # Return response payload so verify.html can intercept user_name dynamically for visual slides
        return {
            "status": "success", 
            "message": "Account verified successfully.", 
            "user_name": user_name
        }
        
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
    finally:
        cursor.close()
        conn.close()


@app.post("/api/signin")
def signin(credentials: UserSignIn):
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    
    cursor.execute(f"""
        SELECT id, name, email, password, is_verified, pomo_time, short_time, long_time, 
               long_interval, auto_break, auto_pomo, selected_sound 
        FROM users WHERE email = {p}
    """, (credentials.email,))
    
    user_record = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if not user_record:
        raise HTTPException(status_code=401, detail="Invalid email address or password.")
        
    user_id, name, email, stored_hash, is_verified, pomo, short, long_b, interval, auto_b, auto_p, sound = user_record
    
    if not verify_password(credentials.password, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid email address or password.")
    
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


#  SECURED APPLICATION RESOURCE ENDPOINTS (JWT ENFORCED)

@app.get("/api/tasks")
def get_tasks(token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    cursor.execute(f"SELECT id, text, completed FROM tasks WHERE user_id = {p}", (user_id,))
    records = cursor.fetchall()
    cursor.close()
    conn.close()
    return [{"id": r[0], "text": r[1], "completed": bool(r[2])} for r in records]


@app.post("/api/tasks")
def add_task(task: TaskCreate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    try:
        cursor.execute(
            f"INSERT INTO tasks (id, user_id, text, completed) VALUES ({p}, {p}, {p}, 0)",
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
    p = get_db_placeholder()
    cursor.execute(f"DELETE FROM tasks WHERE id = {p} AND user_id = {p}", (task_id, user_id))
    conn.commit()
    cursor.close()
    conn.close()
    return {"status": "success"}


@app.put("/api/tasks/{task_id}")
def toggle_task_backend(task_id: str, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    cursor.execute(f"SELECT completed FROM tasks WHERE id = {p} AND user_id = {p}", (task_id, user_id))
    record = cursor.fetchone()
    if record:
        new_status = 0 if record[0] == 1 else 1
        cursor.execute(f"UPDATE tasks SET completed = {p} WHERE id = {p} AND user_id = {p}", (new_status, task_id, user_id))
        conn.commit()
    cursor.close()
    conn.close()
    return {"status": "success"}


@app.post("/api/settings/save")
def save_user_settings(data: SettingsUpdate, token_data: dict = Depends(verify_jwt_token)):
    user_id = token_data["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    
    auto_break_int = 1 if data.auto_break else 0
    auto_pomo_int = 1 if data.auto_pomo else 0
    
    try:
        cursor.execute(f"""
            UPDATE users SET 
                pomo_time = {p}, short_time = {p}, long_time = {p}, 
                long_interval = {p}, auto_break = {p}, auto_pomo = {p}, selected_sound = {p}
            WHERE id = {p}
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
    p = get_db_placeholder()
    try:
        cursor.execute(f"""
            INSERT INTO analytics_logs (user_id, task_text, duration_minutes)
            VALUES ({p}, {p}, {p})
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
    conn = get_db_connection()
    cursor = conn.cursor()
    p = get_db_placeholder()
    
    if IS_POSTGRES:
        if range_type == "7days": date_filter = "CURRENT_DATE - INTERVAL '7 days'"
        elif range_type == "30days": date_filter = "CURRENT_DATE - INTERVAL '30 days'"
        elif range_type == "1year": date_filter = "CURRENT_DATE - INTERVAL '1 year'"
        else: date_filter = "CURRENT_DATE - INTERVAL '7 days'"
        
        query_trend = f"""
            SELECT timestamp::date as focus_date, SUM(duration_minutes) 
            FROM analytics_logs 
            WHERE user_id = {p} AND timestamp >= {date_filter}
            GROUP BY focus_date ORDER BY focus_date ASC
        """
        query_tasks = f"""
            SELECT task_text, COUNT(*) as cycles 
            FROM analytics_logs 
            WHERE user_id = {p} AND timestamp >= {date_filter}
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
            WHERE user_id = {p} AND date(timestamp) >= {date_filter}
            GROUP BY focus_date ORDER BY focus_date ASC
        """
        query_tasks = f"""
            SELECT task_text, COUNT(*) as cycles 
            FROM analytics_logs 
            WHERE user_id = {p} AND date(timestamp) >= {date_filter}
            GROUP BY task_text ORDER BY cycles DESC LIMIT 5
        """

    cursor.execute(query_trend, (user_id,))
    daily_trends = [{"date": str(r[0]), "minutes": r[1]} for r in cursor.fetchall()]

    cursor.execute(query_tasks, (user_id,))
    top_tasks = [{"task": r[0], "cycles": r[1]} for r in cursor.fetchall()]

    cursor.execute(f"SELECT SUM(duration_minutes) FROM analytics_logs WHERE user_id = {p}", (user_id,))
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



#  PUBLIC CORE HEALTH MONITORING ENDPOINT
@app.api_route("/api/health", methods=["GET", "HEAD"])
def database_and_server_health_check(request: Request):
    """Public diagnostic health checkpoint for Render uptime monitors."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1;")
        cursor.fetchone()
        cursor.close()
        conn.close()
        
        return {
            "status": "healthy",
            "environment": "production",
            "database": "connected",
            "message": "Pomora core engine is operational."
        }
    except Exception as database_error:
        raise HTTPException(
            status_code=500, 
            detail=f"Core system degradation detected: {str(database_error)}"
        )