const cron = require("node-cron");
const db = require("../../db");

// runs daily at 5 AM
cron.schedule("* * * * *", async () => {
  try {
    console.log("🔁 Running recurring task generator...");

    // 1. GET EXISTING RECURRING TASKS
    const result = await db.query(`
      SELECT 
        id,
        title,
        startdate,
        duedate,
        assignedto,
        employeeids,
        priority,
        description,
        recurringtype
      FROM "Admintasks"
      WHERE recurringtype IN ('Daily', 'Weekly', 'Monthly')
    `);

    console.log("Tasks found:", result.rows.length);

    // 2. LOOP TASKS
    for (const task of result.rows) {
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

      // 3. INSERT NEW TASK
      await db.query(`
        INSERT INTO "Admintasks"
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
    }

    console.log("✅ Recurring tasks generated successfully");
  } catch (err) {
    console.error("❌ Recurring job error:", err.message);
  }
});