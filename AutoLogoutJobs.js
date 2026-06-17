const cron = require("node-cron");
const pool = require("./db");

const autoLogoutJob = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("Running midnight auto logout job...");

      // ✅ Get latest attendance + employee schedule_out
      const result = await pool.query(`
        SELECT DISTINCT ON (a.employee_id)
          a.id,
          a.employee_id,
          a.status,
          a.timestamp,
          s.schedule_out
        FROM attendance a
        LEFT JOIN employee_shifts s 
          ON s.employee_id = a.employee_id
        ORDER BY a.employee_id, a.timestamp DESC;
      `);

      const latestRecords = result.rows;

      // ✅ Only employees still ON DUTY
      const missingOut = latestRecords.filter(
        (row) => row.status === "On Duty"
      );

      if (missingOut.length === 0) {
        console.log("No missing out punch users.");
        return;
      }

      // ✅ Auto logout using schedule_out time (NOT NOW)
      for (const emp of missingOut) {
        const logoutTime = emp.schedule_out || new Date();

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
            logoutTime, // ✅ schedule_out used here
            true,
            "System auto logout at scheduled out time",
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