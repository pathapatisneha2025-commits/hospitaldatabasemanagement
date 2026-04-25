const cron = require("node-cron");
const pool = require("../../db");

cron.schedule("5 0 * * *", async () => {
  try {
    console.log("🔁 Running recurring task generator...");

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
      let nextDate = new Date(task.DueDate);

      // 👉 DAILY
      if (task.RecurringType === "Daily") {
        nextDate.setDate(nextDate.getDate() + 1);
      }

      // 👉 WEEKLY
      if (task.RecurringType === "Weekly") {
        nextDate.setDate(nextDate.getDate() + 7);
      }

      // 👉 MONTHLY
      if (task.RecurringType === "Monthly") {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }

      await pool.query(`
        INSERT INTO Admintasks
        ("Title","StartDate","DueDate","AssignedTo","EmployeeIDs","Priority","Description","RecurringType","Status")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        task.Title,
        nextDate,
        nextDate,
        task.AssignedTo,
        task.EmployeeIDs,
        task.Priority,
        task.Description,
        task.RecurringType,
        "Pending"
      ]);
    }

    console.log("✅ Recurring tasks generated successfully");
  } catch (err) {
    console.error("❌ Recurring job error:", err.message);
  }
});