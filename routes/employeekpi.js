const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection



router.get("/leavessummary/:employee_id", async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const getDaysInMonth = (month, year) =>
      new Date(year, month, 0).getDate();

    // 1️⃣ Working days
    const workingDaysResult = await pool.query(
      `SELECT working_days 
       FROM employee_working_days 
       WHERE employee_id = $1`,
      [req.params.employee_id]
    );

    const totalDays = workingDaysResult.rows[0]?.working_days || 0;

    // 2️⃣ Monthly + Annual paid leaves (same logic as yours)
    const daysInCurrentMonth = getDaysInMonth(currentMonth, currentYear);
    const monthlyPaidLeaves = Math.max(daysInCurrentMonth - totalDays, 0);

    const totalAnnualDays = totalDays * 12;

    const totalDaysInYear = Array.from({ length: 12 }, (_, i) =>
      getDaysInMonth(i + 1, currentYear)
    ).reduce((a, b) => a + b, 0);

    const totalAnnualPaidLeaves = Math.max(
      totalDaysInYear - totalAnnualDays,
      0
    );

    // 3️⃣ Monthly used leaves
    const leaveResultMonth = await pool.query(
      `SELECT COALESCE(SUM(leavestaken),0) AS used_leaves
       FROM leaves
       WHERE employee_id = $1
         AND start_date >= date_trunc('month', CURRENT_DATE)
         AND start_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')`,
      [req.params.employee_id]
    );

    const monthlyUsedLeaves = parseFloat(
      leaveResultMonth.rows[0].used_leaves
    );

    // 4️⃣ Annual used leaves
    const leaveResultYear = await pool.query(
      `SELECT COALESCE(SUM(leavestaken),0) AS used_leaves
       FROM leaves
       WHERE employee_id = $1
         AND start_date >= date_trunc('year', CURRENT_DATE)
         AND start_date < (date_trunc('year', CURRENT_DATE) + interval '1 year')`,
      [req.params.employee_id]
    );

    const annualUsedLeaves = parseFloat(
      leaveResultYear.rows[0].used_leaves
    );

    // 5️⃣ 🚨 Unauthorized Leaves (NEW LOGIC)
    const unauthorizedResult = await pool.query(
      `
      SELECT COUNT(*) AS unauthorized_leaves
      FROM attendance a
      LEFT JOIN leaves l
        ON l.employee_id = a.employee_id
        AND a.timestamp::date BETWEEN l.start_date AND l.end_date
      WHERE a.employee_id = $1
        AND a.status = 'cancelled'
        AND EXTRACT(MONTH FROM a.timestamp) = $2
        AND EXTRACT(YEAR FROM a.timestamp) = $3
        AND l.id IS NULL
      `,
      [req.params.employee_id, currentMonth, currentYear]
    );

    const unauthorizedLeaves = parseInt(
      unauthorizedResult.rows[0].unauthorized_leaves || 0,
      10
    );

    // 6️⃣ Remaining leaves
    const remainingMonthlyPaidLeaves = Math.max(
      monthlyPaidLeaves - monthlyUsedLeaves,
      0
    );

    const remainingAnnualPaidLeaves = Math.max(
      totalAnnualPaidLeaves - annualUsedLeaves,
      0
    );

    // ✅ RESPONSE
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
        remaining_annual_paid_leaves: remainingAnnualPaidLeaves,

        // 🔥 NEW FIELD
        unauthorized_leaves: unauthorizedLeaves,
      },
    });
  } catch (error) {
    console.error("Employee leave summary error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.get("/attendancesummary/:employee_id", async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // 1️⃣ Get working days
    const workingDaysResult = await pool.query(
      `
      SELECT working_days 
      FROM employee_working_days 
      WHERE employee_id = $1
      `,
      [req.params.employee_id]
    );

    const totalDays =
      parseInt(workingDaysResult.rows[0]?.working_days, 10) || 0;

    // 2️⃣ Attendance Summary
    const attendanceResult = await pool.query(
      `
      SELECT 
        COUNT(*) FILTER (WHERE a.status = 'On Duty') AS total_present,

        COUNT(*) FILTER (WHERE a.status = 'Absent') AS total_absent,

        COUNT(*) FILTER (
          WHERE a.status = 'On Duty' 
          AND e.schedule_in IS NOT NULL 
          AND a.timestamp IS NOT NULL
          AND a.timestamp::time > e.schedule_in
        ) AS total_late,

        COUNT(*) FILTER (
          WHERE a.status = 'On Duty'
          AND e.schedule_out IS NOT NULL
          AND a.checkout_time IS NOT NULL
          AND a.checkout_time::time < e.schedule_out
        ) AS total_early_departures,

        COUNT(*) FILTER (
          WHERE a.status = 'On Duty'
          AND (
            a.timestamp IS NULL 
            OR a.checkout_time IS NULL
          )
        ) AS total_missing_punches,

        COUNT(*) FILTER (
          WHERE a.status = 'On Duty'
          AND e.schedule_out IS NOT NULL
          AND a.checkout_time IS NOT NULL
          AND a.checkout_time::time > e.schedule_out
          AND COALESCE(a.overtime_approved, false) = false
        ) AS total_overtime_without_approval

      FROM attendance a
      LEFT JOIN employees e ON e.id = $1
      WHERE 
      (
        a.employee_id = $1
        OR a.phone = e.mobile
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
      total_early_departures: 0,
      total_missing_punches: 0,
      total_overtime_without_approval: 0,
    };

    return res.json({
      success: true,
      employee_id: req.params.employee_id,
      month: currentMonth,
      year: currentYear,
      summary: {
        total_present: parseInt(summary.total_present, 10) || 0,
        total_late: parseInt(summary.total_late, 10) || 0,
        total_absent: parseInt(summary.total_absent, 10) || 0,
        total_early_departures:
          parseInt(summary.total_early_departures, 10) || 0,
        total_missing_punches:
          parseInt(summary.total_missing_punches, 10) || 0,
        total_overtime_without_approval:
          parseInt(summary.total_overtime_without_approval, 10) || 0,
        total_days: totalDays,
      },
    });
  } catch (error) {
    console.error("Employee monthly summary error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
module.exports = router;