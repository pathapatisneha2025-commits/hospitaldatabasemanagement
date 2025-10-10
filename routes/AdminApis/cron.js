// routes/cron.js
const express = require("express");
const router = express.Router();
const pool = require("../../db"); // adjust path if needed

// 🔐 Optional security key to protect endpoint
const CRON_SECRET = process.env.CRON_SECRET || "my_secret_key";

// -------------------- RUN RECURRING TASKS --------------------
router.get("/run-task", async (req, res) => {
  try {
    const { secret } = req.query;
    if (secret !== CRON_SECRET) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    console.log("Cron job triggered:", new Date());

    // 🧠 Fetch all recurring tasks
    const recurringTasks = await pool.query(
      `SELECT * FROM Admintasks WHERE RecurringType != 'Not Recurring'`
    );

    if (recurringTasks.rows.length === 0) {
      return res.status(200).json({ success: true, message: "No recurring tasks found" });
    }

    const now = new Date();

    for (const task of recurringTasks.rows) {
      const { id, title, startdate, duedate, recurringtype, assignedto, priority, attachment, description } = task;

      const dueDate = new Date(duedate);

      // ✅ Only create a new task if current date is past dueDate
      if (now >= dueDate) {

        // Calculate next start and end date without mutating original
        let newStart = new Date(startdate);
        let newEnd;

        switch (recurringtype) {
          case "Daily":
            newStart.setDate(newStart.getDate() + 1);
            newEnd = new Date(newStart);
            newEnd.setDate(newEnd.getDate() + 1);
            break;

          case "Weekly":
            newStart.setDate(newStart.getDate() + 7);
            newEnd = new Date(newStart);
            newEnd.setDate(newEnd.getDate() + 7);
            break;

          case "Monthly":
            newStart.setMonth(newStart.getMonth() + 1);
            newEnd = new Date(newStart);
            newEnd.setMonth(newEnd.getMonth() + 1);
            break;

          default:
            continue; // skip if unrecognized
        }

        // 🔎 Check if task for the next start date already exists
        const existing = await pool.query(
          `SELECT 1 FROM Admintasks WHERE title=$1 AND startdate=$2`,
          [title, newStart]
        );

        if (existing.rowCount === 0) {
          // 🆕 Insert new recurring task
          const insertQuery = `
            INSERT INTO Admintasks 
            (Title, StartDate, DueDate, AssignedTo, Priority, Attachment, Description, RecurringType)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `;

          await pool.query(insertQuery, [
            title,
            newStart,
            newEnd,
            assignedto,
            priority,
            attachment,
            description,
            recurringtype,
          ]);

          console.log(`Recurring task created: ${title} (${recurringtype})`);
        } else {
          console.log(`Recurring task already exists: ${title} (${recurringtype})`);
        }
      }
    }

    res.status(200).json({ success: true, message: "Recurring task check completed successfully" });
  } catch (error) {
    console.error("Error running recurring task:", error.message);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = router;
