// --- PRODUCTION SERVER ROUTING CONFIG ---
const IS_PRODUCTION =
  window.location.hostname !== "127.0.0.1" &&
  window.location.hostname !== "localhost";

const BACKEND_URL = "https://pomora-backend-api.onrender.com";

const API_BASE_URL = IS_PRODUCTION ? BACKEND_URL : "${API_BASE_URL}";

// Pomora - Master Productivity Application Architecture Engine

const PomodoroTimer = {
  timeLeft: 25 * 60,
  timerId: null,
  isRunning: false,
  currentMode: "pomodoro",
  pomodoroHistoryCount: 1,

  // NEW: System clock reference point anchors to prevent mobile background drift
  expectedEndTime: null,
  lastTickTimestamp: null,

  // Global Configurable Variable State Options Profile Defaults
  config: {
    durations: { pomodoro: 25, short: 5, long: 15 },
    longBreakInterval: 4,
    autoStartBreaks: false,
    autoStartPomodoros: false,
    selectedSound: "digital-alarm-buzzer",
  },

  stats: { totalFocusSeconds: 0, totalRestSeconds: 0, cyclesCompleted: 0 },

  initElements() {
    this.display = document.querySelector(".timer-display");
    this.startBtn = document.querySelector(".start-btn");
    this.modeButtons = document.querySelectorAll(".mode-btn");
    this.progressBarFill = document.querySelector(".progress-bar-fill");
    this.containerHead = document.querySelector(".container-head");
    this.settingsOpenBtn = document.querySelectorAll(".nav-btn")[1];

    this.taskNumberDisplay = document.getElementById("taskNumberDisplay");
    this.taskMessageDisplay = document.getElementById("taskMessageDisplay");
    this.focusTimeDisplay = document.getElementById("totalFocusTimeDisplay");
    this.restTimeDisplay = document.getElementById("totalRestTimeDisplay");
    this.cyclesDisplay = document.getElementById("pomodorosCompletedDisplay");

    this.resetBtn = document.getElementById("resetTimerBtn");
    this.skipBtn = document.getElementById("skipTimerBtn");
  },

  init() {
    this.initElements();
    if (!this.display || !this.startBtn) return;

    const savedTime = localStorage.getItem("pomora_timeLeft");
    const savedMode = localStorage.getItem("pomora_currentMode");
    const savedCount = localStorage.getItem("pomora_historyCount");
    const savedStats = localStorage.getItem("pomora_analytics_stats");

    if (savedMode) this.currentMode = savedMode;
    if (savedCount) this.pomodoroHistoryCount = parseInt(savedCount, 10);
    if (savedStats) this.stats = JSON.parse(savedStats);

    const activeUserData = localStorage.getItem("pomora_active_user");
    if (activeUserData) {
      const user = JSON.parse(activeUserData);
      if (user.config) this.config = user.config;

      const loginNavBtn = document.querySelector(".login-btn");
      if (loginNavBtn)
        loginNavBtn.textContent = `Hi, ${user.name.split(" ")[0]}`;
    } else {
      const savedConfig = localStorage.getItem("pomora_user_config");
      if (savedConfig) this.config = JSON.parse(savedConfig);
    }

    if (savedTime) {
      this.timeLeft = parseInt(savedTime, 10);
    } else {
      this.timeLeft = this.config.durations[this.currentMode] * 60;
    }

    this.applyThemeStyles(this.currentMode);
    this.registerEvents();
    this.updateDisplay();
    this.updateAutomationText();
    this.renderAnalytics();
  },

  registerEvents() {
    this.startBtn.addEventListener("click", () => this.toggleTimer());
    this.modeButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const targetMode = e.target.textContent.toLowerCase().trim();
        if (targetMode === "pomodoro") this.switchMode("pomodoro");
        if (targetMode === "short break") this.switchMode("short");
        if (targetMode === "long break") this.switchMode("long");
      });
    });
    if (this.resetBtn)
      this.resetBtn.addEventListener("click", () => this.resetCurrentRound());
    if (this.skipBtn)
      this.skipBtn.addEventListener("click", () => this.skipCurrentRound());
  },

  toggleTimer() {
    if (this.isRunning) this.pause();
    else this.start();
  },

  // FIXED: Overhauled to secure dynamic epoch timestamp reference targets
  start() {
    this.isRunning = true;
    this.startBtn.textContent = "PAUSE";
    this.startBtn.style.boxShadow = "none";
    this.startBtn.style.transform = "translateY(6px)";

    const now = Date.now();
    // Establish a fixed system wall clock target deadline for execution loops
    this.expectedEndTime = now + this.timeLeft * 1000;
    this.lastTickTimestamp = now;

    this.timerId = setInterval(() => {
      const currentTickTime = Date.now();

      // Calculate true delta gap to determine exactly how many seconds passed while frozen
      const msRemaining = this.expectedEndTime - currentTickTime;
      const actualElapsedSeconds = Math.round(
        (currentTickTime - this.lastTickTimestamp) / 1000,
      );

      // Convert true milliseconds parameter back down to remaining counter integers
      this.timeLeft = Math.ceil(msRemaining / 1000);
      this.lastTickTimestamp = currentTickTime;

      // Safely apply true delta durations to analytics logs to catch up instantly on screen wake
      if (actualElapsedSeconds > 0) {
        if (this.currentMode === "pomodoro") {
          this.stats.totalFocusSeconds += actualElapsedSeconds;
        } else {
          this.stats.totalRestSeconds += actualElapsedSeconds;
        }
      }

      // Check if target deadline boundaries collapsed to zero
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.updateDisplay();
        this.renderAnalytics();
        this.handleAutomatedProgression();
      } else {
        this.updateDisplay();
        this.renderAnalytics();
      }
    }, 1000);
  },

  pause() {
    this.isRunning = false;
    clearInterval(this.timerId);
    this.startBtn.textContent = "START";
    this.startBtn.style.boxShadow = "rgb(235, 235, 235) 0px 6px 0px";
    this.startBtn.style.transform = "none";
    this.saveStateToStorage();
  },

  switchMode(mode) {
    this.pause();
    this.currentMode = mode;
    this.timeLeft = this.config.durations[mode] * 60;
    this.applyThemeStyles(mode);
    this.updateDisplay();
    this.updateAutomationText();
  },

  resetCurrentRound() {
    this.pause();
    this.timeLeft = this.config.durations[this.currentMode] * 60;
    this.updateDisplay();
    this.saveStateToStorage();
    console.log(`Timer Reset: Returned to start of ${this.currentMode} round.`);
  },

  skipCurrentRound() {
    if (confirm("Are you sure you want to skip this current round?")) {
      console.log(`Timer Skip: Forcing automated progression pipeline.`);
      this.handleAutomatedProgression();
    }
  },

  applyThemeStyles(mode) {
    if (this.containerHead) {
      this.containerHead.classList.remove(
        "theme-pomodoro",
        "theme-short",
        "theme-long",
      );
      this.containerHead.classList.add(`theme-${mode}`);
    }
    this.modeButtons.forEach((btn) => {
      const txt = btn.textContent.toLowerCase().trim();
      const match =
        (mode === "pomodoro" && txt === "pomodoro") ||
        (mode === "short" && txt === "short break") ||
        (mode === "long" && txt === "long break");
      btn.classList.toggle("active", match);
    });
  },

  handleAutomatedProgression() {
    this.pause();
    this.playAlertSound(this.config.selectedSound);

    if ("vibrate" in navigator) {
      // Vibrates for 500ms, pauses for 300ms, vibrates for 500ms
      navigator.vibrate([500, 300, 500]);
    }

    let nextMode = "pomodoro";
    let alertMsg = "";
    let alertTitle = "Pomora Timer";

    if (this.currentMode === "pomodoro") {
      this.stats.cyclesCompleted++;

      const activeTasks =
        typeof TaskManager !== "undefined"
          ? TaskManager.tasks.filter((t) => !t.completed)
          : [];
      const currentTaskName =
        activeTasks.length > 0 ? activeTasks[0].text : "Generic Focus Session";
      const sessionMinutes = this.config.durations.pomodoro;

      this.dispatchAnalyticsToBackend(currentTaskName, sessionMinutes);

      if (this.pomodoroHistoryCount % this.config.longBreakInterval === 0) {
        alertTitle = "Break Time! 🏆";
        alertMsg = "Incredible focus! You earned a long break.";
        nextMode = "long";
      } else {
        alertTitle = "Session Done! ☕";
        alertMsg = "Focus round complete! Time for a short break.";
        nextMode = "short";
      }
      this.pomodoroHistoryCount++;
    }

    this.sendSystemNotification(alertTitle, alertMsg);

    this.currentMode = nextMode;
    this.timeLeft = this.config.durations[nextMode] * 60;
    this.applyThemeStyles(nextMode);
    this.updateDisplay();
    this.updateAutomationText();
    this.saveStateToStorage();

    const shouldAutoStart =
      (nextMode === "pomodoro" && this.config.autoStartPomodoros) ||
      (nextMode !== "pomodoro" && this.config.autoStartBreaks);
    if (shouldAutoStart) {
      setTimeout(() => this.start(), 1000);
    }
  },

  sendSystemNotification(title, message) {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      const notification = new Notification(title, {
        body: message,
        icon: "assets/img/logo.png",
        tag: "pomora-alert",
        silent: true,
      });

      setTimeout(() => notification.close(), 5000);

      notification.onclick = function () {
        window.focus();
        notification.close();
      };
    }
  },

  updateAutomationText() {
    if (!this.taskNumberDisplay || !this.taskMessageDisplay) return;

    if (this.currentMode === "pomodoro") {
      this.taskNumberDisplay.style.display = "inline-block";
      const activeTasks =
        typeof TaskManager !== "undefined"
          ? TaskManager.tasks.filter((t) => !t.completed)
          : [];

      if (activeTasks.length > 0) {
        this.taskNumberDisplay.textContent = "Focusing on:";
        this.taskMessageDisplay.textContent = `"${activeTasks[0].text}"`;
      } else {
        this.taskNumberDisplay.textContent = `#${this.pomodoroHistoryCount}`;
        this.taskMessageDisplay.textContent = "Time to focus!";
      }
    } else {
      this.taskNumberDisplay.style.display = "none";
      this.taskMessageDisplay.textContent = "Resting... recharge your battery!";
    }
  },

  updateDisplay() {
    const mins = Math.floor(this.timeLeft / 60);
    const secs = this.timeLeft % 60;
    const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    if (this.display) this.display.textContent = formatted;
    document.title = `${formatted} - Automated Tracker`;

    if (this.progressBarFill) {
      const total = this.config.durations[this.currentMode] * 60;
      this.progressBarFill.style.width = `${(this.timeLeft / total) * 100}%`;
    }
  },

  renderAnalytics() {
    if (!this.focusTimeDisplay) return;
    const focusMins = Math.floor(this.stats.totalFocusSeconds / 60);
    const restMins = Math.floor(this.stats.totalRestSeconds / 60);

    this.focusTimeDisplay.textContent = `${focusMins}m`;
    this.restTimeDisplay.textContent = `${restMins}m`;
    this.cyclesDisplay.textContent = this.stats.cyclesCompleted;
  },

  saveStateToStorage() {
    localStorage.setItem("pomora_timeLeft", this.timeLeft);
    localStorage.setItem("pomora_currentMode", this.currentMode);
    localStorage.setItem("pomora_historyCount", this.pomodoroHistoryCount);
    localStorage.setItem("pomora_analytics_stats", JSON.stringify(this.stats));
  },

  async dispatchAnalyticsToBackend(taskText, minutes) {
    const token = localStorage.getItem("pomora_token");
    if (!token) {
      console.log("Guest mode: Skipping backend analytics sync.");
      return;
    }

    try {
      await fetch(`${API_BASE_URL}/api/analytics/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          task_text: taskText,
          duration_minutes: minutes,
        }),
      });
      console.log(
        `Analytics Logged: Focused on "${taskText}" for ${minutes} mins.`,
      );
    } catch (error) {
      console.error("Failed to sync focus analytics log to server: ", error);
    }
  },

  playAlertSound(soundType) {
    if (!soundType) soundType = "digital-alarm-buzzer";
    const audioTrack = new Audio(`assets/sounds/${soundType}.wav`);
    audioTrack.volume = 0.6;
    audioTrack
      .play()
      .catch((err) => console.log("Audio play request blocked: ", err));
  },
};

// Pomora - Settings Configuration Control Manager Modal Object

const SettingsManager = {
  init() {
    this.modalOverlay = document.getElementById("settingsModal");
    this.openBtn = PomodoroTimer.settingsOpenBtn;
    this.closeBtn = document.getElementById("closeSettingsBtn");
    this.saveBtn = document.getElementById("saveSettingsBtn");
    this.testSoundBtn = document.getElementById("testSoundBtn");
    this.requestNotifyBtn = document.getElementById("requestNotificationBtn");

    this.inputPomo = document.getElementById("inputPomo");
    this.inputShort = document.getElementById("inputShort");
    this.inputLong = document.getElementById("inputLong");
    this.inputLongInterval = document.getElementById("inputLongInterval");
    this.inputAutoBreak = document.getElementById("inputAutoBreak");
    this.inputAutoPomo = document.getElementById("inputAutoPomo");
    this.inputSoundAlert = document.getElementById("inputSoundAlert");

    if (!this.modalOverlay || !this.openBtn) return;

    this.registerEvents();
    this.checkNotificationStatus();
  },

  registerEvents() {
    this.openBtn.addEventListener("click", () => this.openSettings());
    this.closeBtn.addEventListener("click", () => this.closeSettings());
    this.saveBtn.addEventListener("click", () => this.saveSettings());
    this.testSoundBtn.addEventListener("click", () => this.triggerSoundTest());
    this.requestNotifyBtn.addEventListener("click", () =>
      this.requestNotificationPermission(),
    );

    this.modalOverlay.addEventListener("click", (e) => {
      if (e.target === this.modalOverlay) this.closeSettings();
    });
  },

  checkNotificationStatus() {
    if (!("Notification" in window)) {
      this.requestNotifyBtn.style.display = "none";
      return;
    }
    if (Notification.permission === "granted") {
      this.requestNotifyBtn.textContent = "Enabled";
      this.requestNotifyBtn.classList.add("granted");
      this.requestNotifyBtn.disabled = true;
    }
  },

  requestNotificationPermission() {
    if (!("Notification" in window)) return;

    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        this.requestNotifyBtn.textContent = "Enabled";
        this.requestNotifyBtn.classList.add("granted");
        this.requestNotifyBtn.disabled = true;
        new Notification("Notifications Activated!", {
          body: "Pomora updates will show here dynamic text alerts.",
        });
      }
    });
  },

  triggerSoundTest() {
    PomodoroTimer.playAlertSound(this.inputSoundAlert.value);
  },

  openSettings() {
    const config = PomodoroTimer.config;
    this.inputPomo.value = config.durations.pomodoro;
    this.inputShort.value = config.durations.short;
    this.inputLong.value = config.durations.long;
    this.inputLongInterval.value = config.longBreakInterval;
    this.inputAutoBreak.checked = config.autoStartBreaks;
    this.inputAutoPomo.checked = config.autoStartPomodoros;
    this.inputSoundAlert.value = config.selectedSound;

    this.modalOverlay.style.display = "flex";
    setTimeout(() => this.modalOverlay.classList.add("show"), 10);
  },

  closeSettings() {
    this.modalOverlay.classList.remove("show");
    setTimeout(() => (this.modalOverlay.style.display = "none"), 250);
  },

  async saveSettings() {
    // FIXED: Moved variable definition to the absolute top of the method so it is never undefined
    const updatedConfig = {
      durations: {
        pomodoro: Math.max(1, parseInt(this.inputPomo.value, 10) || 25),
        short: Math.max(1, parseInt(this.inputShort.value, 10) || 5),
        long: Math.max(1, parseInt(this.inputLong.value, 10) || 15),
      },
      longBreakInterval: Math.max(
        1,
        parseInt(this.inputLongInterval.value, 10) || 4,
      ),
      autoStartBreaks: this.inputAutoBreak.checked,
      autoStartPomodoros: this.inputAutoPomo.checked,
      selectedSound: this.inputSoundAlert.value,
    };

    // Instantly update engine's live configuration rules in memory
    PomodoroTimer.config = updatedConfig;

    // Pull secure session token
    const token = localStorage.getItem("pomora_token");

    // --- FALLBACK SYSTEM ROUTER ---
    if (token) {
      // USER IS SIGNED IN: Save securely to backend database using headers
      try {
        // await fetch("${API_BASE_URL}/api/settings/save", {
        await fetch(`${API_BASE_URL}/api/settings/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            pomo_time: updatedConfig.durations.pomodoro,
            short_time: updatedConfig.durations.short,
            long_time: updatedConfig.durations.long,
            long_interval: updatedConfig.longBreakInterval,
            auto_break: updatedConfig.autoStartBreaks,
            auto_pomo: updatedConfig.autoStartPomodoros,
            selected_sound: updatedConfig.selectedSound,
          }),
        });

        // Also mirror it cleanly into the active user session memory data profiles cache
        const activeUserData = localStorage.getItem("pomora_active_user");
        if (activeUserData) {
          const user = JSON.parse(activeUserData);
          user.config = updatedConfig;
          localStorage.setItem("pomora_active_user", JSON.stringify(user));
        }
      } catch (error) {
        console.error("Failed to sync backend settings preferences: ", error);
      }
    } else {
      // GUEST MODE FALLBACK: Write cleanly to guest profile storage key only
      localStorage.setItem("pomora_user_config", JSON.stringify(updatedConfig));
    }

    // Recalibrate tracking interfaces and exit modal view
    PomodoroTimer.switchMode(PomodoroTimer.currentMode);
    this.closeSettings();
  },
};

const TaskManager = {
  tasks: [],
  activeUserId: null, // Tracks database ownership dynamically

  init() {
    this.addBtn = document.querySelector(".add-task-btn");
    this.tasksContainer = document.querySelector(".tasks-list");
    this.formCard = document.getElementById("taskFormCard");
    this.inputField = document.getElementById("taskInputField");
    this.saveBtn = document.getElementById("saveTaskBtn");
    this.cancelBtn = document.getElementById("cancelTaskBtn");
    this.successBanner = document.getElementById("tasksSuccessBanner");
    this.clearBtn = document.getElementById("clearTasksBtn");

    if (!this.addBtn || !this.tasksContainer) return;

    // Check who is logged in from our AuthManager session storage
    const activeUserData = localStorage.getItem("pomora_active_user");
    if (activeUserData) {
      const user = JSON.parse(activeUserData);
      this.activeUserId = user.id;
      this.fetchTasksFromBackend(); // Load tasks from python database
    } else {
      // Guest mode fallback if no user profile is active
      const savedTasks = localStorage.getItem("pomora_tasks");
      if (savedTasks) this.tasks = JSON.parse(savedTasks);
      this.render();
    }

    this.registerEvents();
  },

  registerEvents() {
    this.addBtn.addEventListener("click", () => this.showForm());
    this.cancelBtn.addEventListener("click", () => this.hideForm());
    this.saveBtn.addEventListener("click", () => this.handleSubmit());
    this.inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.handleSubmit();
      if (e.key === "Escape") this.hideForm();
    });
    if (this.clearBtn)
      this.clearBtn.addEventListener("click", () => this.clearAllTasks());
  },

  async fetchTasksFromBackend() {
    const token = localStorage.getItem("pomora_token");
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }, // Attach Token
      });
      if (response.ok) {
        this.tasks = await response.json();
        this.render();
        PomodoroTimer.updateAutomationText();
      }
    } catch (error) {
      console.error("Failed to sync database tasks: ", error);
    }
  },

  async addTask(text) {
    const stringId = String(Date.now());
    const newTask = { id: stringId, text: text, completed: false };

    this.tasks.push(newTask);
    this.render();
    PomodoroTimer.updateAutomationText();

    const token = localStorage.getItem("pomora_token");
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: stringId, text: text }), // No user_id needed in body anymore!
        });
      } catch (err) {
        console.error("Database task add sync crash: ", err);
      }
    } else {
      localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
    }
  },

  async toggleTask(id) {
    this.tasks = this.tasks.map((task) => {
      if (task.id === id) return { ...task, completed: !task.completed };
      return task;
    });
    this.render();
    PomodoroTimer.updateAutomationText();

    const token = localStorage.getItem("pomora_token");
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/tasks/toggle/${id}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.error("Database status toggle sync failed: ", err);
      }
    } else {
      localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
    }
  },

  async deleteTask(id, event) {
    event.stopPropagation();
    this.tasks = this.tasks.filter((task) => task.id !== id);
    this.render();
    PomodoroTimer.updateAutomationText();

    const token = localStorage.getItem("pomora_token");
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/tasks/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.error("Database deletion sync failure: ", err);
      }
    } else {
      localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
    }
  },

  showForm() {
    if (this.formCard) this.formCard.style.display = "flex";
    this.addBtn.style.display = "none";
    if (this.inputField) this.inputField.focus();
  },
  hideForm() {
    if (this.formCard) this.formCard.style.display = "none";
    this.addBtn.style.display = "flex";
    if (this.inputField) this.inputField.value = "";
  },

  handleSubmit() {
    const textValue = this.inputField.value.trim();
    if (textValue !== "") {
      this.addTask(textValue);
      this.hideForm();
    } else {
      this.inputField.focus();
    }
  },

  async addTask(text) {
    const stringId = String(Date.now()); // Structured uniform ID token string
    const newTask = { id: stringId, text: text, completed: false };

    this.tasks.push(newTask);
    this.render();
    PomodoroTimer.updateAutomationText();

    if (this.activeUserId) {
      // Blaster pipeline request payload packet directly to SQLite tables
      try {
        await fetch("${API_BASE_URL}/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: stringId,
            user_id: this.activeUserId,
            text: text,
          }),
        });
      } catch (err) {
        console.error("Database task add sync crash: ", err);
      }
    } else {
      localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
    }
  },

  async toggleTask(id) {
    this.tasks = this.tasks.map((task) => {
      if (task.id === id) return { ...task, completed: !task.completed };
      return task;
    });
    this.render();
    PomodoroTimer.updateAutomationText();

    if (this.activeUserId) {
      try {
        await fetch(`${API_BASE_URL}/api/tasks/toggle/${id}`, {
          method: "POST",
        });
      } catch (err) {
        console.error("Database status toggle sync failed: ", err);
      }
    } else {
      localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
    }
  },

  async deleteTask(id, event) {
    event.stopPropagation();
    this.tasks = this.tasks.filter((task) => task.id !== id);
    this.render();
    PomodoroTimer.updateAutomationText();

    if (this.activeUserId) {
      try {
        await fetch(`${API_BASE_URL}/api/tasks/${id}`, {
          method: "DELETE",
        });
      } catch (err) {
        console.error("Database deletion sync failure: ", err);
      }
    } else {
      localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
    }
  },

  clearAllTasks() {
    this.popConfettiBurst();
    setTimeout(async () => {
      if (this.activeUserId) {
        // Wipe current database batch records sequentially
        for (let t of this.tasks) {
          try {
            await fetch(`${API_BASE_URL}/api/tasks/${t.id}`, {
              method: "DELETE",
            });
          } catch (e) {}
        }
      }
      this.tasks = [];
      localStorage.removeItem("pomora_tasks");
      this.render();
      PomodoroTimer.updateAutomationText();
    }, 400);
  },

  popConfettiBurst() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      400,
      audioCtx.currentTime + 0.15,
    );
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  },

  render() {
    this.tasksContainer.innerHTML = "";
    const totalTasksCount = this.tasks.length;
    const fullyCompletedCount = this.tasks.filter((t) => t.completed).length;
    const isListComplete =
      totalTasksCount > 0 && totalTasksCount === fullyCompletedCount;
    if (this.successBanner) {
      if (isListComplete) {
        this.successBanner.style.display = "flex";
        this.tasksContainer.style.marginBottom = "0px";
      } else {
        this.successBanner.style.display = "none";
        this.tasksContainer.style.marginBottom =
          totalTasksCount > 0 ? "15px" : "0px";
      }
    }
    this.tasks.forEach((task) => {
      const taskItem = document.createElement("div");
      taskItem.className = `task-item ${task.completed ? "completed" : ""}`;
      taskItem.addEventListener("click", () => this.toggleTask(task.id));
      taskItem.innerHTML = ` <div class="task-item-left"> <span class="check-icon">${task.completed ? "✓" : "○"}</span> <span class="task-item-text">${task.text}</span> </div> <button class="task-delete-btn" title="Delete Task">×</button> `;
      const deleteBtn = taskItem.querySelector(".task-delete-btn");
      deleteBtn.addEventListener("click", (e) => this.deleteTask(task.id, e));
      this.tasksContainer.appendChild(taskItem);
    });
  },
};

// ... (Keep your existing ReportManager object unchanged) ...
const ReportManager = {
  init() {
    this.openBtn = document.querySelector(".nav-btn");
    this.modalOverlay = document.getElementById("reportModal");
    this.closeBtn = document.getElementById("closeReportBtn");
    this.modalFocusHours = document.getElementById("modalFocusHours");
    this.modalCyclesCount = document.getElementById("modalCyclesCount");
    this.graphFocusBar = document.getElementById("graphFocusBar");
    this.graphRestBar = document.getElementById("graphRestBar");
    if (!this.openBtn || !this.modalOverlay || !this.closeBtn) return;
    this.registerEvents();
  },
  registerEvents() {
    this.openBtn.addEventListener("click", () => this.openReport());
    this.closeBtn.addEventListener("click", () => this.closeReport());
    this.modalOverlay.addEventListener("click", (e) => {
      if (e.target === this.modalOverlay) this.closeReport();
    });
  },
  openReport() {
    const stats = PomodoroTimer.stats;
    const hoursFocused = (stats.totalFocusSeconds / 3600).toFixed(1);
    this.modalFocusHours.textContent = `${hoursFocused}h`;
    this.modalCyclesCount.textContent = stats.cyclesCompleted;
    const totalCombinedSeconds =
      stats.totalFocusSeconds + stats.totalRestSeconds;
    if (totalCombinedSeconds > 0) {
      this.graphFocusBar.style.height = `${(stats.totalFocusSeconds / totalCombinedSeconds) * 100}%`;
      this.graphRestBar.style.height = `${(stats.totalRestSeconds / totalCombinedSeconds) * 100}%`;
    } else {
      this.graphFocusBar.style.height = "0%";
      this.graphRestBar.style.height = "0%";
    }
    this.modalOverlay.style.display = "flex";
    setTimeout(() => this.modalOverlay.classList.add("show"), 10);
  },
  closeReport() {
    this.modalOverlay.classList.remove("show");
    setTimeout(() => {
      this.modalOverlay.style.display = "none";
    }, 250);
  },
};

/**
 * Pomora - Authentication Access Management Panel Control Engine
 */
/**
 * Pomora - Authentication Access Management Panel Control Engine
 */
const AuthManager = {
  init() {
    this.openBtn = document.querySelector(".login-btn");
    this.modalOverlay = document.getElementById("authModal");
    this.closeBtn = document.getElementById("closeAuthBtn");

    this.signInView = document.getElementById("signInView");
    this.signUpView = document.getElementById("signUpView");
    this.toSignUpBtn = document.getElementById("switchToSignUp");
    this.toSignInBtn = document.getElementById("switchToSignIn");

    if (!this.openBtn || !this.modalOverlay || !this.closeBtn) return;

    this.registerEvents();
    this.checkInitialSessionState(); // NEW: Checks session locks instantly on page load
  },

  registerEvents() {
    // MODIFIED: Only open the login window box if the user is a guest
    this.openBtn.addEventListener("click", () => {
      const activeUser = localStorage.getItem("pomora_active_user");
      if (activeUser) {
        // OPTIONAL: If they are logged in, clicking the button could ask to Logout
        if (confirm("Do you want to log out of your account?")) {
          this.handleLogout();
        }
      } else {
        this.openAuthBox();
      }
    });

    this.closeBtn.addEventListener("click", () => this.closeAuthBox());
    this.toSignUpBtn.addEventListener("click", () => this.toggleView("signup"));
    this.toSignInBtn.addEventListener("click", () => this.toggleView("signin"));

    this.modalOverlay.addEventListener("click", (e) => {
      if (e.target === this.modalOverlay) this.closeAuthBox();
    });

    const signUpForm = document.getElementById("signUpForm");
    if (signUpForm) {
      signUpForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleBackendSignUp();
      });
    }

    const signInForm = document.getElementById("signInForm");
    if (signInForm) {
      signInForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleBackendSignIn();
      });
    }
  },

  // NEW: Handles state validation immediately when the app boots up
  checkInitialSessionState() {
    const activeUserData = localStorage.getItem("pomora_active_user");
    if (activeUserData) {
      const user = JSON.parse(activeUserData);
      this.updateNavbarUI(user.name);
    }
  },

  // NEW: Helper method to cleanly alter navbar look and feel properties
  updateNavbarUI(name) {
    if (!this.openBtn) return;
    this.openBtn.textContent = `Hi, ${name.split(" ")[0]}`;
    this.openBtn.style.cursor = "pointer"; // Keeps it clean
    this.openBtn.title = "Click to log out"; // Added hover tooltip hint text
  },

  // NEW: Handles clearing profile state contexts securely
  handleLogout() {
    localStorage.removeItem("pomora_token"); // Clear the token!
    localStorage.removeItem("pomora_active_user");
    localStorage.removeItem("pomora_tasks");

    if (this.openBtn) {
      this.openBtn.textContent = "Sign In";
      this.openBtn.title = "";
    }

    showToast("Logged out successfully.", "info");
    window.location.reload();
  },

  // MODIFIED: Ensure state updates execute instantly inside your existing pipeline method
  async handleBackendSignIn() {
    const emailField = document.getElementById("loginEmail");
    const passwordField = document.getElementById("loginPassword");
    const submitBtn = document.querySelector(
      "#signInForm .auth-submit-master-btn",
    );

    if (!emailField || !passwordField) return;

    submitBtn.textContent = "Verifying Credentials...";
    submitBtn.disabled = true;

    const payload = {
      email: emailField.value.trim(),
      password: passwordField.value,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.status === "success") {
        showToast(data.message, "success");
        // SECURED: Save the token string and the basic user info separately
        localStorage.setItem("pomora_token", data.token);

        localStorage.setItem("pomora_active_user", JSON.stringify(data.user));

        emailField.value = "";
        passwordField.value = "";

        this.closeAuthBox();

        // FIXED: Call the UI updaters engine immediately upon verification confirmation
        this.updateNavbarUI(data.user.name);
        if (typeof TaskManager !== "undefined") {
          TaskManager.fetchTasksFromBackend();
        }

        // Refresh task managers datasets inline without full manual reload
        if (typeof TaskManager !== "undefined") {
          TaskManager.activeUserId = data.user.id;
          TaskManager.fetchTasksFromBackend();
        }
      } else {
        showToast(`Login Error: ${data.detail}`, "error");
      }
    } catch (error) {
      console.error("Network Link Failure Context:", error);
      showToast("Server is busy right now", "error");
    } finally {
      submitBtn.textContent = "Log In";
      submitBtn.disabled = false;
    }
  },

  // NEW: Add this missing method right below handleBackendSignIn()
  async handleBackendSignUp() {
    const nameField = document.getElementById("registerName");
    const emailField = document.getElementById("registerEmail");
    const passwordField = document.getElementById("registerPassword");
    const submitBtn = document.querySelector(
      "#signUpForm .auth-submit-master-btn",
    );

    if (!nameField || !emailField || !passwordField) return;

    // Visual loading state feedback
    submitBtn.textContent = "Creating Account...";
    submitBtn.disabled = true;

    const payload = {
      name: nameField.value.trim(),
      email: emailField.value.trim(),
      password: passwordField.value,
    };

    try {
      // Send data across network to port 8000
      const response = await fetch(`${API_BASE_URL}/api/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.status === "success") {
        // FIXED: Replaced native alert with non-blocking success toast
        showToast(data.message, "success");

        // Flush form values cleanly
        nameField.value = "";
        emailField.value = "";
        passwordField.value = "";

        this.closeAuthBox(); // Hide modal
      } else {
        // FIXED: Replaced native alert with non-blocking error toast
        showToast(
          `Sign Up Failed: ${data.detail || "Unknown error occurred."}`,
          "error",
        );
      }
    } catch (error) {
      console.error("Network Error Connection:", error);
      showToast("Could not connect to the server.", "error");
    } finally {
      // Restore button state
      submitBtn.textContent = "Create Account";
      submitBtn.disabled = false;
    }
  },

  openAuthBox() {
    this.toggleView("signin");
    this.modalOverlay.style.display = "flex";
    setTimeout(() => this.modalOverlay.classList.add("show"), 10);
  },

  closeAuthBox() {
    this.modalOverlay.classList.remove("show");
    setTimeout(() => (this.modalOverlay.style.display = "none"), 250);
  },

  toggleView(targetViewToken) {
    if (targetViewToken === "signup") {
      this.signInView.classList.remove("active");
      this.signUpView.classList.add("active");
    } else {
      this.signUpView.classList.remove("active");
      this.signInView.classList.add("active");
    }
  },
};
/**
 * Global Non-Blocking UI Toast System
 * @param {string} message - Text to display
 * @param {string} type - 'success', 'error', or 'info'
 */
function showToast(message, type = "success") {
  const toast = document.getElementById("globalToast");
  const toastMsg = document.getElementById("toastMessage");

  if (!toast || !toastMsg) return;

  // Reset classes cleanly
  toast.className = `toast-banner ${type}`;
  toastMsg.textContent = message;

  // Slide the banner into view
  toast.classList.add("show");

  // Automatically slide it back out of view after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

const DashboardManager = {
  currentRange: "7days",

  init() {
    this.filterButtons = document.querySelectorAll(".filter-btn");
    this.chartContainer = document.getElementById("dashboardTrendChart");
    this.hoursDisplay = document.getElementById("dashTotalHours");
    this.streakDisplay = document.getElementById("dashStreak");

    if (!this.chartContainer) return;
    this.registerEvents();
  },

  registerEvents() {
    this.filterButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this.filterButtons.forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.currentRange = e.target.getAttribute("data-range");
        this.fetchDashboardData();
      });
    });
  },

  async fetchDashboardData() {
    const token = localStorage.getItem("pomora_token");
    if (!token) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/analytics/dashboard?range_type=${this.currentRange}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.ok) {
        const data = await response.json();
        this.renderDashboard(data);
      }
    } catch (error) {
      console.error("Dashboard calculation link error: ", error);
    }
  },

  renderDashboard(data) {
    // Update basic tracking cards text variables
    this.hoursDisplay.textContent = `${data.summary.total_hours}h`;
    this.streakDisplay.textContent = `${data.summary.streak_days} Days`;

    // Reset and clear old rendering chart elements
    this.chartContainer.innerHTML = "";

    if (data.daily_trends.length === 0) {
      this.chartContainer.innerHTML = `<p class="empty-log-text">No focus sessions tracked in this timeframe yet.</p>`;
      return;
    }

    // Find highest volume minute marker day to balance graph heights proportionally
    const maxMinutes = Math.max(...data.daily_trends.map((d) => d.minutes), 1);

    // Dynamically build and scale HTML layout bar pillars
    data.daily_trends.forEach((day) => {
      const barPercentage = (day.minutes / maxMinutes) * 100;
      const barWrapper = document.createElement("div");
      barWrapper.className = "chart-bar-wrapper";
      barWrapper.innerHTML = `
                <div class="chart-bar-fill" style="height: ${barPercentage}%" title="${day.minutes} Mins on ${day.date}"></div>
                <span class="chart-date-lbl">${day.date.split("-")[2]}</span>
            `;
      this.chartContainer.appendChild(barWrapper);
    });
  },
};

/**
 * Pomora - Dropdown Navigation Dashboard & Workspace Swap Router
 */
/**
 * Pomora - Dropdown Navigation Dashboard & Overlay View Router
 */
const NavigationManager = {
  init() {
    this.menuBtn = document.getElementById("moreMenuBtn");
    this.dropdownCard = document.getElementById("moreDropdownCard");
    this.dashboardBtn = document.getElementById("goToDashboardBtn");
    this.closeOverlayBtn = document.getElementById("closeDashboardOverlayBtn");
    this.logoutBtn = document.getElementById("dropdownLogoutBtn");

    // Workspace Overlay Wrapper Selection Target Target Hooks
    this.fullDashboardOverlay = document.getElementById("fullPageDashboard");

    if (!this.menuBtn || !this.dropdownCard || !this.fullDashboardOverlay)
      return;

    this.registerEvents();
  },

  registerEvents() {
    // Toggle Dropdown Options Menu Card Display layout
    this.menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.dropdownCard.classList.toggle("show");
    });

    // Close dropdown context lists when clicking workspace dead areas
    document.addEventListener("click", () => {
      this.dropdownCard.classList.remove("show");
    });

    // Trigger Launch: Open Full-Screen Performance Dashboard Overlay
    this.dashboardBtn.addEventListener("click", () => {
      const token = localStorage.getItem("pomora_token");
      if (!token) {
        showToast(
          "Please log in to view performance analytics metrics!",
          "error",
        );
        return;
      }
      this.openDashboardOverlay();
    });

    // Dismiss Launch: Close full-screen overlay when clicking Close (×) button
    if (this.closeOverlayBtn) {
      this.closeOverlayBtn.addEventListener("click", () =>
        this.closeDashboardOverlay(),
      );
    }

    // Dismiss Launch: Close overlay when clicking outside the inner modal card container box
    this.fullDashboardOverlay.addEventListener("click", (e) => {
      if (e.target === this.fullDashboardOverlay) {
        this.closeDashboardOverlay();
      }
    });

    // Account Logout handling hook
    if (this.logoutBtn) {
      this.logoutBtn.addEventListener("click", () => {
        if (typeof AuthManager !== "undefined") AuthManager.handleLogout();
      });
    }
  },

  openDashboardOverlay() {
    // Hide the floating navigation menu options popup card
    this.dropdownCard.classList.remove("show");

    // Fire full screen visibility transitions
    this.fullDashboardOverlay.classList.add("show");

    // Dispatch background query payload fetch signals to secure API instantly
    if (typeof DashboardManager !== "undefined") {
      DashboardManager.fetchDashboardData();
    }
  },

  closeDashboardOverlay() {
    // Animate out cleanly smoothly
    this.fullDashboardOverlay.classList.remove("show");
  },
};

/**
 * Pomora Keep-Alive Engine
 * Periodically pings the Render backend to prevent server sleep cycles
 */
const PomoraKeepAlive = {
  init() {
    // Only trigger the background heartbeat ping loop if running live in production
    if (typeof IS_LOCAL !== "undefined" && IS_LOCAL) {
      console.log(
        "Local environment detected. Skipping keep-alive heartbeat loop.",
      );
      return;
    }

    console.log(
      "Pomora Keep-Alive Engine initialized. Heartbeat cycle active.",
    );

    // Fire an immediate initial ping to wake things up, then loop every 12 minutes
    this.pingBackend();

    // 12 minutes = 12 * 60 * 1000 = 720,000 milliseconds
    setInterval(() => {
      this.pingBackend();
    }, 720000);
  },

  async pingBackend() {
    try {
      // A lightweight HEAD request consumes almost zero data but alerts the server process
      await fetch(`${API_BASE_URL}/api/tasks`, { method: "HEAD" });
      console.log(
        "Keep-alive heartbeat signal dispatched successfully to cloud server.",
      );
    } catch (error) {
      // Fail silently in the background without breaking user interaction threads
      console.warn(
        "Keep-alive heartbeat connection sequence experienced a blip:",
        error,
      );
    }
  },
};

// DOM Bootloader Hook initializations
document.addEventListener("DOMContentLoaded", () => {
  PomodoroTimer.init();
  TaskManager.init();
  ReportManager.init();
  SettingsManager.init();
  AuthManager.init();

  // NEW SYSTEM PACK INITIALIZATIONS
  DashboardManager.init();
  NavigationManager.init();

  // Initialize the keep-alive loop when the script mounts execution fields
  PomoraKeepAlive.init();
});
