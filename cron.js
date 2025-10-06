const cron = require("node-cron");
const pool = require("./db");

function getNextDates(startDate, endDate, recurringType) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let newStart, newEnd;

  switch (recurringType) {
    case "Daily":
      newStart = new Date(start.setDate(start.getDate() + 1));
      newEnd = new Date(end.setDate(end.getDate() + 1));
      break;
    case "Weekly":
      newStart = new Date(start.setDate(start.getDate() + 7));
      newEnd = new Date(end.setDate(end.getDate() + 7));
      break;
    case "Monthly":
      newStart = new Date(start.setMonth(start.getMonth() + 1));
      newEnd = new Date(end.setMonth(end.getMonth() + 1));
      break;
    default:
      return null;
  }

  return { newStart, newEnd };
}

async function generateRecurringTasks() {
  try {
    const { rows: tasks } = await pool.query(`
      SELECT DISTINCT ON (Title) *
      FROM admintasks
      WHERE RecurringType != 'Not Recurring'
      ORDER BY Title, StartDate DESC
    `);

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    for (let task of tasks) {
      const nextDates = getNextDates(task.startdate, task.duedate, task.recurringtype);
      if (!nextDates) continue;

      const { newStart, newEnd } = nextDates;
      const newStartDate = newStart.toISOString().split("T")[0];

      // Only create task if newStartDate is exactly tomorrow
      if (newStartDate === tomorrowStr) {
        const exists = await pool.query(
          "SELECT * FROM admintasks WHERE Title=$1 AND DATE(StartDate)=$2",
          [task.title, newStartDate]
        );

        if (exists.rows.length === 0) {
          await pool.query(
            `INSERT INTO admintasks
              (Title, StartDate, DueDate, AssignedTo, Priority, Collaborators, Attachment, Description, Status, RecurringType)
             VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10)`,
            [
              task.title,
              newStart,
              newEnd,
              task.assignedto,
              task.priority,
              task.collaborators,
              task.attachment,
              task.description,
              "Not Started",
              task.recurringtype,
            ]
          );
          console.log(`✅ Generated recurring task: ${task.title} for ${newStartDate}`);
        }
      }
    }
  } catch (err) {
    console.error("Error generating recurring tasks:", err.message);
  }
}

// Run at midnight daily (Asia/Kolkata)
cron.schedule("0 0 * * *", () => {
  console.log("⏰ Running recurring task generator...");
  generateRecurringTasks();
}, { timezone: "Asia/Kolkata" });

// Run once immediately for testing
generateRecurringTasks();
