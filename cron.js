const cron = require("node-cron");
const pool = require("./db");

/* =========================================================
   🗓 Helper: Get Only Next Recurring Date
========================================================= */
function getNextDates(startDate, recurringType) {
  const start = new Date(startDate);
  let nextDate = null;

  switch (recurringType) {
    case "Daily":
      nextDate = new Date(start);
      nextDate.setDate(start.getDate() + 1);
      break;

    case "Weekly":
      nextDate = new Date(start);
      nextDate.setDate(start.getDate() + 7);
      break;

    case "Monthly":
      nextDate = new Date(start);
      nextDate.setMonth(start.getMonth() + 1);
      break;

    default:
      return [];
  }

  return [nextDate]; // return array for compatibility
}

/* =========================================================
   🕗 Schedule Task Creation - Runs Every Day at 6 AM
========================================================= */
cron.schedule("0 6 * * *", async () => {
  console.log("🕗 Running recurring task generator...");

  try {
    // Fetch all tasks that are recurring
    const result = await pool.query(
      "SELECT * FROM tasks WHERE recurringtype IS NOT NULL"
    );

    const tasks = result.rows;

    for (const task of tasks) {
      const nextDates = getNextDates(task.startdate, task.recurringtype);

      for (const nextDate of nextDates) {
        // 🧮 Create new start and due dates (same duration as original)
        const duration =
          new Date(task.duedate).getTime() -
          new Date(task.startdate).getTime();

        const newStart = new Date(nextDate);
        const newDue = new Date(nextDate.getTime() + duration);

        // Only create for tomorrow (not for same day or beyond)
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const tomorrowStr = tomorrow.toISOString().split("T")[0];
        const newStartStr = newStart.toISOString().split("T")[0];

        if (newStartStr === tomorrowStr) {
          await pool.query(
            `INSERT INTO tasks 
             (title, startdate, duedate, assignedto, priority, project, collaborators, attachment, description, status, recurringtype)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              task.title,
              newStart,
              newDue,
              task.assignedto,
              task.priority,
              task.project,
              task.collaborators,
              task.attachment,
              task.description,
              "Not Started",
              task.recurringtype,
            ]
          );

          console.log(`✅ Created next-day task for: ${task.title}`);
        } else {
          console.log(`⏩ Skipped ${task.title} (not for tomorrow)`);
        }
      }
    }

    console.log("🎯 Task generation complete.");
  } catch (err) {
    console.error("❌ Error generating recurring tasks:", err);
  }
});
