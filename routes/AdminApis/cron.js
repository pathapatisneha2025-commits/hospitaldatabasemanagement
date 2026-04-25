const cron = require("node-cron");
const pool = require("../../db");
const { DateTime } = require("luxon");

cron.schedule("5 0 * * *", async () => {
  try {
    console.log("Running recurring task generator...");

    const tasks = await pool.query(`
      SELECT 
        "Title",
        "DueDate",
        "RecurringType",
        "AssignedTo",
        "EmployeeIDs",
        "Priority",
        "Description"
      FROM Admintasks
      WHERE "RecurringType" IN ('Daily', 'Weekly', 'Monthly')
      AND "DueDate" <= NOW()
    `);

    for (const task of tasks.rows) {
      let nextDate = DateTime.fromJSDate(new Date(task.DueDate));

      if (task.RecurringType === "Daily") {
        nextDate = nextDate.plus({ days: 1 });
      }

      if (task.RecurringType === "Weekly") {
        nextDate = nextDate.plus({ weeks: 1 });
      }

      if (task.RecurringType === "Monthly") {
        nextDate = nextDate.plus({ months: 1 });
      }

      await pool.query(`
        INSERT INTO Admintasks
        ("Title","StartDate","DueDate","AssignedTo","EmployeeIDs","Priority","Description","RecurringType","Status")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        task.Title,
        nextDate.toJSDate(),
        nextDate.toJSDate(),
        task.AssignedTo,
        task.EmployeeIDs,
        task.Priority,
        task.Description,
        task.RecurringType,
        "Pending"
      ]);
    }

    console.log("Recurring tasks generated successfully");
  } catch (err) {
    console.error("Recurring job error:", err);
  }
});