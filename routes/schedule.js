const express = require("express");
const cron = require("node-cron");
const fetch = require("node-fetch"); // if Node v18+ you can remove and use global fetch
const pool = require("../db"); // PostgreSQL pool connection

const router = express.Router();

// Store running cron jobs (so we don’t create duplicates)
const cronJobs = {};

// ---------- Helper: Send Push Notification ----------
const sendPushNotification = async (token, title, message) => {
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        sound: "default",
        title,
        body: message,
        data: { type: "attendance_reminder" },
      }),
    });

    const data = await response.json();
    console.log("📩 Expo push response:", data);
  } catch (error) {
    console.error("❌ Push error:", error);
  }
};

// ---------- Save employee schedule ----------
router.post("/setreminder", async (req, res) => {
  const { employeeId, date, startTime, endTime, pushToken } = req.body;

  try {
    await pool.query(
      `INSERT INTO  remainderschedules  (employee_id, date, start_time, end_time, push_token) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id) DO UPDATE 
       SET date=$2, start_time=$3, end_time=$4, push_token=$5`,
      [employeeId, date, startTime, endTime, pushToken]
    );

    // Schedule cron for this employee immediately
    scheduleSingleReminder(employeeId);

    res.json({ success: true, message: "Schedule saved!" });
  } catch (err) {
    console.error("❌ Insert error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- Helper: Schedule reminder for a single employee ----------
const scheduleSingleReminder = async (employeeId) => {
  const result = await pool.query("SELECT * FROM  remainderschedules  WHERE employee_id=$1", [employeeId]);
  const row = result.rows[0];
  if (!row) return;

  const [hours, minutes] = row.start_time.split(":");
  let reminderMinute = parseInt(minutes) - 15;
  let reminderHour = parseInt(hours);

  if (reminderMinute < 0) {
    reminderMinute += 60;
    reminderHour -= 1;
  }

  const cronTime = `${reminderMinute} ${reminderHour} * * *`;

  // If a job already exists for this employee, stop it before creating new
  if (cronJobs[employeeId]) {
    cronJobs[employeeId].stop();
    delete cronJobs[employeeId];
  }

  // Create new cron job
  const job = cron.schedule(cronTime, async () => {
  const message = ` your shift starts in 15 minutes. Don't forget to mark attendance.`;

    // Save to DB
    await pool.query(
      `INSERT INTO  remaindernotifications  (employee_id, title, message, created_at) 
       VALUES ($1, $2, $3, NOW())`,
      [row.employee_id, "Attendance Reminder", message]
    );

    // Send push notification if token exists
    if (row.push_token) {
      await sendPushNotification(row.push_token, "Attendance Reminder", message);
    }

    console.log(`✅ Reminder sent to employee ${row.employee_id}`);
  });

  // Save reference so we can cancel later if updated
  cronJobs[employeeId] = job;
};

// ---------- On server start → schedule reminders for all employees ----------
const scheduleAllReminders = async () => {
  const result = await pool.query("SELECT employee_id FROM remainderschedules");
  result.rows.forEach((row) => scheduleSingleReminder(row.employee_id));
};

scheduleAllReminders();

module.exports = router;
