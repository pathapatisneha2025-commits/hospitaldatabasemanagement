const cron = require("node-cron");
const db = require("../../db");

// ✅ Runs once daily at 5:00 AM
cron.schedule("0 5 * * *", async () => {
  try {
    console.log("🔁 Running recurring task generator...");

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // ✅ ONLY ORIGINAL TASKS (parent)
    const result = await db.query(`
      SELECT *
      FROM admintasks
      WHERE recurringtype IN ('Daily','Weekly','Monthly')
      AND parent_task_id IS NULL
    `);

    for (const task of result.rows) {

      // ✅ 🔒 DUPLICATE PROTECTION (VERY IMPORTANT)
      const alreadyExists = await db.query(`
        SELECT id FROM admintasks
        WHERE parent_task_id = $1
        AND DATE(startdate) = $2
      `, [task.id, todayStr]);

      if (alreadyExists.rows.length > 0) {
        console.log(`⏭️ Task already exists for today: ${task.id}`);
        continue;
      }

      // ✅ CALCULATE DURATION (important)
      const parentStart = new Date(task.startdate);
      const parentEnd = new Date(task.duedate);
      const duration = parentEnd.getTime() - parentStart.getTime();

      let newStart = new Date();
      let newEnd;

      // ✅ GENERATE NEXT DATE BASED ON TYPE
      if (task.recurringtype === "Daily") {
        newStart = new Date(); // today
      }

      if (task.recurringtype === "Weekly") {
        newStart.setDate(newStart.getDate() + 7);
      }

      if (task.recurringtype === "Monthly") {
        newStart.setMonth(newStart.getMonth() + 1);
      }

      // ✅ KEEP SAME TIME + DURATION
      newEnd = new Date(newStart.getTime() + duration);

      // ✅ INSERT NEW TASK
      await db.query(`
        INSERT INTO admintasks
        (title, startdate, duedate, assignedto, employeeids, priority, description, recurringtype, status, parent_task_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        task.title,
        newStart,
        newEnd,
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