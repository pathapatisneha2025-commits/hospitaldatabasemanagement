const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection



router.get("/leavessummary/:employee_id", async (req, res) => {
  try {
    // Automatically get current month/year
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Helper: number of days in a month
    const getDaysInMonth = (month, year) => new Date(year, month, 0).getDate();

    // 1️⃣ Fetch total working days
    const workingDaysResult = await pool.query(
      `SELECT working_days FROM employee_working_days WHERE employee_id = $1`,
      [req.params.employee_id]
    );
    const totalDays = workingDaysResult.rows[0]?.working_days || 0;

    // 2️⃣ Calculate monthly paid leaves
    const daysInCurrentMonth = getDaysInMonth(currentMonth, currentYear);
    const monthlyPaidLeaves = Math.max(daysInCurrentMonth - totalDays, 0);

    // 3️⃣ Calculate annual paid leaves (based on total days of year - working days * 12)
    const totalAnnualDays = totalDays * 12; 
    const totalDaysInYear = Array.from({ length: 12 }, (_, i) =>
      getDaysInMonth(i + 1, currentYear)
    ).reduce((a, b) => a + b, 0);
    const totalAnnualPaidLeaves = Math.max(totalDaysInYear - totalAnnualDays, 0);

    // 4️⃣ Get used leaves for the current month
    const leaveResultMonth = await pool.query(
      `SELECT COALESCE(SUM(leavestaken),0) AS used_leaves
       FROM leaves
       WHERE employee_id = $1
         AND start_date >= date_trunc('month', CURRENT_DATE)
         AND start_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')`,
      [req.params.employee_id]
    );
    const monthlyUsedLeaves = parseFloat(leaveResultMonth.rows[0].used_leaves);

    // 5️⃣ Get used leaves for the current year
    const leaveResultYear = await pool.query(
      `SELECT COALESCE(SUM(leavestaken),0) AS used_leaves
       FROM leaves
       WHERE employee_id = $1
         AND start_date >= date_trunc('year', CURRENT_DATE)
         AND start_date < (date_trunc('year', CURRENT_DATE) + interval '1 year')`,
      [req.params.employee_id]
    );
    const annualUsedLeaves = parseFloat(leaveResultYear.rows[0].used_leaves);

    // 6️⃣ Calculate remaining paid leaves
    const remainingMonthlyPaidLeaves = Math.max(monthlyPaidLeaves - monthlyUsedLeaves, 0);
    const remainingAnnualPaidLeaves = Math.max(totalAnnualPaidLeaves - annualUsedLeaves, 0);

    // ✅ Final response
    return res.json({
      success: true,
      employee_id: req.params.employee_id,
      month: currentMonth,
      year: currentYear,
      summary: {
        total_days: totalDays,
        monthly_paid_leaves: monthlyPaidLeaves,
        monthly_used_leaves: monthlyUsedLeaves,
        remaining_monthly_paid_leaves: remainingMonthlyPaidLeaves,
        total_annual_paid_leaves: totalAnnualPaidLeaves,
        annual_used_leaves: annualUsedLeaves,
        remaining_annual_paid_leaves: remainingAnnualPaidLeaves
      },
    });

  } catch (error) {
    console.error("Employee paid leaves summary error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/attendancesummary/:employee_id", async (req, res) => {
  try {
    // Automatically use current month/year
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // 1️⃣ Fetch total working days from employee_working_days table
    const workingDaysResult = await pool.query(
      `SELECT working_days 
       FROM employee_working_days 
       WHERE employee_id = $1`,
      [req.params.employee_id]
    );

    const totalDays = workingDaysResult.rows[0]?.working_days || 0;

    // 2️⃣ Fetch attendance summary for the employee for current month
    const attendanceResult = await pool.query(
      `
     SELECT 
  COUNT(*) FILTER (WHERE a.status = 'On Duty') AS total_present,
  COUNT(*) FILTER (WHERE a.status = 'Absent') AS total_absent,
  COUNT(*) FILTER (
    WHERE a.status = 'On Duty' 
    AND e.schedule_in IS NOT NULL 
    AND a.timestamp::time > e.schedule_in
  ) AS total_late
FROM attendance a
LEFT JOIN employees e ON e.id = $1
WHERE 
(
  a.employee_id = $1
  OR 
  a.phone = e.phone
)
AND EXTRACT(MONTH FROM a.timestamp) = $2
AND EXTRACT(YEAR FROM a.timestamp) = $3;
      `,
      [req.params.employee_id, currentMonth, currentYear]
    );

    const summary = attendanceResult.rows[0] || {
      total_present: 0,
      total_absent: 0,
      total_late: 0,
    };

    return res.json({
      success: true,
      employee_id: req.params.employee_id,
      month: currentMonth,
      year: currentYear,
      summary: {
        total_present: parseInt(summary.total_present, 10),
        total_late: parseInt(summary.total_late, 10),
        total_absent: parseInt(summary.total_absent, 10),
        total_days: totalDays,
      },
    });
  } catch (error) {
    console.error("Employee monthly summary error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
module.exports = router;