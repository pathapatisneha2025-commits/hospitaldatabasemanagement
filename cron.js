const cron = require("node-cron");
const pool = require("./db"); // Adjust path if needed

// Helper function to calculate next occurrence
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
    // 1️⃣ Get all recurring tasks
    const { rows: tasks } = await pool.query(
      "SELECT * FROM admintasks WHERE RecurringType != 'Not Recurring'"
    );

    for (let task of tasks) {
      // 2️⃣ Get the latest occurrence for this task
      const { rows: latest } = await pool.query(
        "SELECT * FROM admintasks WHERE Title=$1 ORDER BY StartDate DESC LIMIT 1",
        [task.title]
      );

      if (!latest[0]) continue;
      const baseTask = latest[0];

      // 3️⃣ Calculate next occurrence from latest task
      const nextDates = getNextDates(baseTask.startdate, baseTask.duedate, baseTask.recurringtype);
      if (!nextDates) continue;

      const { newStart, newEnd } = nextDates;

      // 4️⃣ Check if task already exists
      const exists = await pool.query(
        "SELECT * FROM admintasks WHERE Title=$1 AND StartDate=$2",
        [task.title, newStart]
      );
      if (exists.rows.length > 0) continue;

      // 5️⃣ Insert new occurrence
      await pool.query(
        `INSERT INTO admintasks
          (Title, StartDate, DueDate, AssignedTo, Priority, Project, Collaborators, Attachment, Description, Status, RecurringType)
          VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11)`,
        [
          baseTask.title,
          newStart,
          newEnd,
          baseTask.assignedto,
          baseTask.priority,
          baseTask.project,
          baseTask.collaborators,
          baseTask.attachment,
          baseTask.description,
          "Not Started",
          baseTask.recurringtype
        ]
      );
      console.log(`Generated recurring task: ${task.title} for ${newStart}`);
    }
  } catch (err) {
    console.error("Error generating recurring tasks:", err.message);
  }
}

// ✅ Run every minute
cron.schedule("* * * * *", () => {
  console.log("⏰ Running recurring task generator...");
  generateRecurringTasks();
});
