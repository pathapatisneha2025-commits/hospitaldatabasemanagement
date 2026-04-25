const cron = require("node-cron");
const db = require("../../db");

// runs daily at 5 AM
cron.schedule("*0 5 * * *", async () => {  try {
    console.log("🔁 Running recurring task generator...");

    // ONLY ORIGINAL TASKS
    const result = await db.query(`
      SELECT *
      FROM admintasks
      WHERE recurringtype IN ('Daily','Weekly','Monthly')
      AND parent_task_id IS NULL
    `);

    for (const task of result.rows) {

      // 👉 ALWAYS BASE FROM ORIGINAL START/END
      let nextStart = new Date(task.startdate);
      let nextDue = new Date(task.duedate);

      // DAILY
      if (task.recurringtype === "Daily") {
        nextStart.setDate(nextStart.getDate() + 1);
        nextDue.setDate(nextDue.getDate() + 1);
      }

      // WEEKLY
      if (task.recurringtype === "Weekly") {
        nextStart.setDate(nextStart.getDate() + 7);
        nextDue.setDate(nextDue.getDate() + 7);
      }

      // MONTHLY
      if (task.recurringtype === "Monthly") {
        nextStart.setMonth(nextStart.getMonth() + 1);
        nextDue.setMonth(nextDue.getMonth() + 1);
      }

      // CREATE NEW TASK
      await db.query(`
        INSERT INTO admintasks
        (title,startdate,duedate,assignedto,employeeids,priority,description,recurringtype,status,parent_task_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        task.title,
        nextStart,
        nextDue,
        task.assignedto,
        task.employeeids,
        task.priority,
        task.description,
        task.recurringtype,
        "Pending",
        task.id
      ]);
    }

    console.log("✅ Recurring tasks generated successfully");
  } catch (err) {
    console.error("❌ Recurring job error:", err.message);
  }
});