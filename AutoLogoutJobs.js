const cron = require("node-cron");
const pool = require("./db");

const autoLogoutJob = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("Running midnight auto logout job...");

      const result = await pool.query(`
        SELECT DISTINCT ON (a.employee_id)
          a.id,
          a.employee_id,
          a.phone,
          a.status,
          a.timestamp,
          e.id AS emp_id,
          e.mobile,
          e.schedule_out
        FROM attendance a
        LEFT JOIN employees e 
          ON (
            e.id::text = a.employee_id::text
            OR e.mobile::text = a.employee_id::text
            OR e.mobile::text = a.phone::text
          )
        ORDER BY a.employee_id, a.timestamp DESC;
      `);

      const latestRecords = result.rows;

      const missingOut = latestRecords.filter(
        (row) => row.status === "On Duty"
      );

      if (missingOut.length === 0) {
        console.log("No missing out punch users.");
        return;
      }

      for (const emp of missingOut) {
        if (!emp.schedule_out) {
          console.log(`Skipping employee ${emp.employee_id} (no schedule_out)`);
          continue;
        }

        await pool.query(
          `
          INSERT INTO attendance (
            employee_id,
            status,
            timestamp,
            auto_logout,
            logout_reason
          )
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            emp.employee_id,
            "System Logged Out",
            emp.schedule_out,
            true,
            "Auto logout based on employee scheduled out time",
          ]
        );
      }

      console.log(`System logged out ${missingOut.length} employees`);
    } catch (err) {
      console.error("Midnight auto logout error:", err);
    }
  });
};

module.exports = autoLogoutJob;