const cron = require("node-cron");
const db = require("../../db");

cron.schedule("0 5 * * *", async () => {
  try {
    console.log("🔁 Running recurring task generator...");

    const tasks = await db.query(`
  INSERT INTO Admintasks
  ("title","startdate","duedate","assignedto","employeeids","priority","description","recurringtype","status")
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
`, [
  task.title,
  nextDate,
  nextDate,
  task.assignedto,
  task.employeeids,
  task.priority,
  task.description,
  task.recurringtype,
  "Pending"
]);
    for (const task of tasks.rows) {
      let nextDate = new Date(task.duedate);

      // DAILY
      if (task.recurringtype === "Daily") {
        nextDate.setDate(nextDate.getDate() + 1);
      }

      // WEEKLY
      if (task.recurringtype === "Weekly") {
        nextDate.setDate(nextDate.getDate() + 7);
      }

      // MONTHLY
      if (task.recurringtype === "Monthly") {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }

      await db.query(`
        INSERT INTO Admintasks
        (title, startdate, duedate, assignedto, employeeids, priority, description, recurringtype, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        task.title,
        nextDate,
        nextDate,
        task.assignedto,
        task.employeeids,
        task.priority,
        task.description,
        task.recurringtype,
        "Pending"
      ]);
    }

    console.log("✅ Recurring tasks generated successfully");
  } catch (err) {
    console.error("❌ Recurring job error:", err.message);
  }
});