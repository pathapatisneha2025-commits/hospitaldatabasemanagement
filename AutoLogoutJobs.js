const cron = require("node-cron");
const pool = require("./db"); // correct path

const autoLogoutJob = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("Running midnight auto logout job...");

      const result = await pool.query(`
        SELECT DISTINCT ON (employee_id)
          id,
          employee_id,
          status,
          timestamp
        FROM attendance
        ORDER BY employee_id, timestamp DESC;
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
        await pool.query(
          `
          INSERT INTO attendance (
            employee_id,
            status,
            timestamp,
            auto_logout,
            logout_reason
          )
          VALUES ($1, $2, NOW(), $3, $4)
          `,
          [
            emp.employee_id,
            "System Logged Out",
            true,
            "System auto logout at midnight due to missing punch out",
          ]
        );
      }

      console.log(`System logged out ${missingOut.length} employees`);
    } catch (err) {
      console.error("Midnight logout error:", err);
    }
  });
};

module.exports = autoLogoutJob;