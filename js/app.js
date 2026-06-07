/**
 * Pomora - Master Productivity Application Architecture Engine
 */

const PomodoroTimer = {
  timeLeft: 25 * 60,
  timerId: null,
  isRunning: false,
  currentMode: "pomodoro",
  pomodoroHistoryCount: 1,

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
    this.settingsOpenBtn = document.querySelectorAll(".nav-btn")[1]; // Second button in nav area (Setting)

    this.taskNumberDisplay = document.getElementById("taskNumberDisplay");
    this.taskMessageDisplay = document.getElementById("taskMessageDisplay");
    this.focusTimeDisplay = document.getElementById("totalFocusTimeDisplay");
    this.restTimeDisplay = document.getElementById("totalRestTimeDisplay");
    this.cyclesDisplay = document.getElementById("pomodorosCompletedDisplay");
  },

  init() {
    this.initElements();
    if (!this.display || !this.startBtn) return;

    // Load historical records + custom configuration profiles database files
    const savedConfig = localStorage.getItem("pomora_user_config");
    const savedTime = localStorage.getItem("pomora_timeLeft");
    const savedMode = localStorage.getItem("pomora_currentMode");
    const savedCount = localStorage.getItem("pomora_historyCount");
    const savedStats = localStorage.getItem("pomora_analytics_stats");

    if (savedConfig) this.config = JSON.parse(savedConfig);
    if (savedMode) this.currentMode = savedMode;
    if (savedCount) this.pomodoroHistoryCount = parseInt(savedCount, 10);
    if (savedStats) this.stats = JSON.parse(savedStats);

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
  },

  toggleTimer() {
    if (this.isRunning) this.pause();
    else this.start();
  },

  start() {
    this.isRunning = true;
    this.startBtn.textContent = "PAUSE";
    this.startBtn.style.boxShadow = "none";
    this.startBtn.style.transform = "translateY(6px)";

    this.timerId = setInterval(() => {
      this.timeLeft--;

      if (this.currentMode === "pomodoro") this.stats.totalFocusSeconds++;
      else this.stats.totalRestSeconds++;

      this.updateDisplay();
      this.renderAnalytics();

      if (this.timeLeft <= 0) {
        this.handleAutomatedProgression();
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

    let nextMode = "pomodoro";
    let alertMsg = "";
    let alertTitle = "Pomora Timer";

    if (this.currentMode === "pomodoro") {
      this.stats.cyclesCompleted++;

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
    } else {
      alertTitle = "Back to Work! ⚡";
      alertMsg = "Break is over! Time to focus on your goals.";
      nextMode = "pomodoro";
    }

    // FIRE THE REFACTORED DESKTOP PUSH NOTIFICATION
    this.sendSystemNotification(alertTitle, alertMsg);

    // Transition modes smoothly on autopilot
    this.currentMode = nextMode;
    this.timeLeft = this.config.durations[nextMode] * 60;
    this.applyThemeStyles(nextMode);
    this.updateDisplay();
    this.updateAutomationText();
    this.saveStateToStorage();

    // Handle Auto-Start Configurations seamlessly without alert freezes
    const shouldAutoStart =
      (nextMode === "pomodoro" && this.config.autoStartPomodoros) ||
      (nextMode !== "pomodoro" && this.config.autoStartBreaks);
    if (shouldAutoStart) {
      setTimeout(() => this.start(), 1000);
    }
  },

  sendSystemNotification(title, message) {
    // 1. Guard clause: Check if the browser even supports HTML5 Notifications
    if (!("Notification" in window)) {
      console.warn("This browser does not support desktop notifications.");
      return;
    }

    // 2. If permission is granted, build and fire the notification payload
    if (Notification.permission === "granted") {
      const notification = new Notification(title, {
        body: message,
        icon: "assets/img/logo.png", // Optional: Points to an app icon image if you have one
        tag: "pomora-alert", // Overwrites previous alerts so multiple tabs don't stack cards
        silent: true, // We set this to true because our custom audio buzzer handles the sound!
      });

      // Auto-close the notification card after 5 seconds to stay clean
      setTimeout(() => {
        notification.close();
      }, 5000);

      // Optional: Bring the user back to the Pomora tab if they click the desktop notification
      notification.onclick = function () {
        window.focus();
        notification.close();
      };
    } else if (Notification.permission !== "denied") {
      // 3. Fallback: If they haven't explicitly denied it yet, ask for permission on the fly
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          this.sendSystemNotification(title, message);
        }
      });
    }
  },

  updateAutomationText() {
    if (!this.taskNumberDisplay || !this.taskMessageDisplay) return;

    if (this.currentMode === "pomodoro") {
      this.taskNumberDisplay.style.display = "inline-block";
      const activeTasks = TaskManager.tasks.filter((t) => !t.completed);

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

  // CUSTOM MULTI-SOUND AUDIO SELECTOR ROUTING PIPELINE
  playAlertSound(soundType) {
    // Safety Fallback: If for ANY reason soundType comes back blank, instantly force your buzzer default string
    if (!soundType) {
      soundType = "digital-alarm-buzzer";
    }

    if (soundType === "digital-alarm-buzzer") {
      const audioTrack = new Audio(`assets/sounds/digital-alarm-buzzer.wav`);
      audioTrack.volume = 0.6;
      audioTrack
        .play()
        .catch((err) => console.log("Audio play request blocked: ", err));
    } else {
      // General handler for alternative options
      const audioTrack = new Audio(`assets/sounds/${soundType}.wav`);
      audioTrack.volume = 0.6;
      audioTrack
        .play()
        .catch((err) => console.log("Audio play request blocked: ", err));
    }
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

    // Form fields bindings selectors targets
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
    const soundSelected = this.inputSoundAlert.value;
    PomodoroTimer.playAlertSound(soundSelected);
  },

  openSettings() {
    // Sync configuration profiles data straight into inputs form layouts indicators fields values
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

  saveSettings() {
    // Build fresh configuration mapping extraction from input nodes values metrics
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

    PomodoroTimer.config = updatedConfig;
    localStorage.setItem("pomora_user_config", JSON.stringify(updatedConfig));

    // Re-calibrate active running tracking timers offsets values immediately to match settings changes
    PomodoroTimer.switchMode(PomodoroTimer.currentMode);

    this.closeSettings();
  },
};

// ... (Keep your existing TaskManager object unchanged) ...
const TaskManager = {
  tasks: [],
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
    const savedTasks = localStorage.getItem("pomora_tasks");
    if (savedTasks) this.tasks = JSON.parse(savedTasks);
    this.registerEvents();
    this.render();
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
  addTask(text) {
    const newTask = { id: Date.now(), text: text, completed: false };
    this.tasks.push(newTask);
    this.saveToStorage();
    this.render();
    PomodoroTimer.updateAutomationText();
  },
  toggleTask(id) {
    this.tasks = this.tasks.map((task) => {
      if (task.id === id) return { ...task, completed: !task.completed };
      return task;
    });
    this.saveToStorage();
    this.render();
    PomodoroTimer.updateAutomationText();
  },
  deleteTask(id, event) {
    event.stopPropagation();
    this.tasks = this.tasks.filter((task) => task.id !== id);
    this.saveToStorage();
    this.render();
    PomodoroTimer.updateAutomationText();
  },
  clearAllTasks() {
    this.popConfettiBurst();
    setTimeout(() => {
      this.tasks = [];
      this.saveToStorage();
      this.render();
      PomodoroTimer.updateAutomationText();
    }, 400);
  },
  saveToStorage() {
    localStorage.setItem("pomora_tasks", JSON.stringify(this.tasks));
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
const AuthManager = {
    init() {
        // Core framework UI element selector targeting anchor references hooks
        this.openBtn = document.querySelector('.login-btn'); // Matches your navbar sign in class link token
        this.modalOverlay = document.getElementById('authModal');
        this.closeBtn = document.getElementById('closeAuthBtn');

        // View tabs subcomponent panels cards targets
        this.signInView = document.getElementById('signInView');
        this.signUpView = document.getElementById('signUpView');
        this.toSignUpBtn = document.getElementById('switchToSignUp');
        this.toSignInBtn = document.getElementById('switchToSignIn');

        if (!this.openBtn || !this.modalOverlay || !this.closeBtn) return;

        this.registerEvents();
    },

    registerEvents() {
        // Basic open/close modal visibility window togglers
        this.openBtn.addEventListener('click', () => this.openAuthBox());
        this.closeBtn.addEventListener('click', () => this.closeAuthBox());

        // Inside card toggle views routing triggers
        this.toSignUpBtn.addEventListener('click', () => this.toggleView('signup'));
        this.toSignInBtn.addEventListener('click', () => this.toggleView('signin'));

        // Dismiss frame if overlay gap background layout layer gets tapped
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) this.closeAuthBox();
        });
    },

    openAuthBox() {
        // Reset defaults panel tab visibility mapping to standard log in layout mode on boot
        this.toggleView('signin');
        this.modalOverlay.style.display = 'flex';
        setTimeout(() => this.modalOverlay.classList.add('show'), 10);
    },

    closeAuthBox() {
        this.modalOverlay.classList.remove('show');
        setTimeout(() => this.modalOverlay.style.display = 'none', 250);
    },

    toggleView(targetViewToken) {
        if (targetViewToken === 'signup') {
            this.signInView.classList.remove('active');
            this.signUpView.classList.add('active');
        } else {
            this.signUpView.classList.remove('active');
            this.signInView.classList.add('active');
        }
    }
};

// DOM Bootloader Hook initializations
document.addEventListener("DOMContentLoaded", () => {
  PomodoroTimer.init();
  TaskManager.init();
  ReportManager.init();
  SettingsManager.init();
  AuthManager.init();
});
