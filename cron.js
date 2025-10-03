const cron = require("node-cron");
const pool = require("../db"); // PostgreSQL pool

// Helper function to get next occurrence
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

// Function to create recurring tasks
async function generateRecurringTasks() {
  try {
    const { rows: tasks } = await pool.query(
      "SELECT * FROM Admintasks WHERE RecurringType != 'Not Recurring'"
    );

    const today = new Date().toISOString().split("T")[0]; // yyyy-mm-dd

    for (let task of tasks) {
      const nextDates = getNextDates(task.StartDate, task.DueDate, task.RecurringType);
      if (!nextDates) continue;

      const { newStart, newEnd } = nextDates;

      // Check if a task already exists for the next occurrence
      const exists = await pool.query(
        "SELECT * FROM Admintasks WHERE Title=$1 AND StartDate=$2",
        [task.Title, newStart]
      );

      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO Admintasks
            (Title, StartDate, DueDate, AssignedTo, Priority, Project, Collaborators, Attachment, Description, Status, RecurringType)
            VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10, $11)`,
          [
            task.Title,
            newStart,
            newEnd,
            task.AssignedTo,
            task.Priority,
            task.Project,
            task.Collaborators,
            task.Attachment,
            task.Description,
            "Not Started",
            task.RecurringType
          ]
        );
        console.log(`Generated recurring task: ${task.Title} for ${newStart}`);
      }
    }
  } catch (err) {
    console.error("Error generating recurring tasks:", err.message);
  }
}

// Run every day at midnight
// Run every minute (for testing)
cron.schedule("* * * * *", () => {
  console.log("⏰ Running recurring task generator...");
  generateRecurringTasks();
});

