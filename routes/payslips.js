const express = require("express");
const pool = require("../db"); // PostgreSQL connection
const PDFDocument = require("pdfkit");

const router = express.Router();

router.get("/all", async (req, res) => {
  try {
    // Get current date in Asia/Kolkata timezone
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const today = new Date(now);

    const year = today.getFullYear();
    const month = today.getMonth() + 1; // JS months are 0-based

    // 1️⃣ Get all employees + salary deductions (as before)
    const query = `
      SELECT e.id AS employee_id,
             e.full_name AS employee,
             e.role AS designation,
             e.monthly_salary AS basicsalary,
             COALESCE(MAX(l.salary_deduction), 0) AS deductions,
             (e.monthly_salary - COALESCE(MAX(l.salary_deduction), 0)) AS net_pay,
             to_char(make_date($1::int, $2::int, 1), 'Month YYYY') AS date,
             COALESCE(ps.status, 'pending') AS status
      FROM employees e
      LEFT JOIN leaves l
        ON e.id = l.employee_id
       AND (
            (EXTRACT(YEAR FROM l.start_date) = $1::int AND EXTRACT(MONTH FROM l.start_date) = $2::int)
            OR
            (EXTRACT(YEAR FROM l.end_date) = $1::int AND EXTRACT(MONTH FROM l.end_date) = $2::int)
            OR
            (l.start_date <= make_date($1::int, $2::int, 1)
             AND l.end_date >= (make_date($1::int, $2::int, 1) + interval '1 month - 1 day'))
          )
      LEFT JOIN payslip_status ps
        ON e.id = ps.employee_id
       AND ps.year = $1
       AND ps.month = $2
      GROUP BY e.id, e.full_name, e.role, e.monthly_salary, ps.status
      ORDER BY e.full_name;
    `;

    const result = await pool.query(query, [year, month]);
    let payslips = result.rows;

    // 2️⃣ Loop employees and calculate unauthorized leaves + penalty
    for (let slip of payslips) {
      let unauthorizedLeaves = 0;
      let unauthorizedPenaltyTotal = 0;

      // 🔎 Fetch all cancelled leaves for this employee in this month
      const cancelledLeaves = await pool.query(
        `SELECT id, start_date, end_date, leave_type
         FROM leaves
         WHERE employee_id = $1
           AND status ILIKE 'cancelled'
           AND (
              (EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) = $3)
              OR
              (EXTRACT(YEAR FROM end_date) = $2 AND EXTRACT(MONTH FROM end_date) = $3)
           )`,
        [slip.employee_id, year, month]
      );

      // Deduction slab (same logic as in /salary-deduction)
      let unauthorizedPenalty = 0;
      if (slip.basicsalary >= 4500 && slip.basicsalary <= 7500) {
        unauthorizedPenalty = 35;
      } else if (slip.basicsalary >= 7501 && slip.basicsalary <= 9500) {
        unauthorizedPenalty = 70;
      } else if (slip.basicsalary >= 9501) {
        unauthorizedPenalty = 105;
      }

      // 3️⃣ Process each cancelled leave
      for (let leave of cancelledLeaves.rows) {
        if (leave.leave_type.toLowerCase() === "halfday") {
          unauthorizedLeaves += 0.5;
        } else {
          // Count "Off Duty" days in attendance for that leave period
          const attendanceResult = await pool.query(
            `SELECT COUNT(*) AS off_duty_days
             FROM attendance
             WHERE employee_id = $1
               AND status ILIKE 'Off Duty'
               AND timestamp >= $2::date
               AND timestamp <= $3::date`,
            [slip.employee_id, leave.start_date, leave.end_date]
          );

          unauthorizedLeaves += parseInt(attendanceResult.rows[0].off_duty_days, 10) || 0;
        }
      }

      // 4️⃣ Unauthorized penalty
      unauthorizedPenaltyTotal = unauthorizedLeaves * unauthorizedPenalty;

      // 5️⃣ Update slip object
      slip.unauthorized_leaves = unauthorizedLeaves;
      slip.unauthorized_penalty = unauthorizedPenaltyTotal;
      slip.net_pay = slip.basicsalary - slip.deductions - unauthorizedPenaltyTotal;
    }

    res.json(payslips);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


router.post("/status/:employeeId", async (req, res) => {
  const { employeeId } = req.params;
  const { status } = req.body; // expects any status value

  try {
    // Use current year and month in Asia/Kolkata timezone
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const today = new Date(now);
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // JS months are 0-based

    const query = `
      INSERT INTO payslip_status (employee_id, year, month, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (employee_id, year, month)
      DO UPDATE SET status = EXCLUDED.status
    `;

    await pool.query(query, [employeeId, year, month, status]);
    res.json({ message: `Status updated to ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/status/:employeeId", async (req, res) => {
  const { employeeId } = req.params;

  try {
    // Current year/month in Asia/Kolkata timezone
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const today = new Date(now);
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    const query = `
      SELECT status, created_at, updated_at
      FROM payslip_status
      WHERE employee_id = $1
        AND year = $2
        AND month = $3
      LIMIT 1
    `;

    const result = await pool.query(query, [employeeId, year, month]);

    if (result.rows.length === 0) {
      return res.json({ employeeId, year, month, status: "pending" });
    }

    res.json({
      employeeId,
      year,
      month,
      status: result.rows[0].status,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/pdf/:year/:month/:employeeId", async (req, res) => {
  try {
    const { year, month, employeeId } = req.params;

    if (!year || !month || !employeeId) {
      return res.status(400).json({ error: "Missing required params" });
    }

  const query = `
  SELECT e.full_name,
         e.role,
         e.monthly_salary,
         COALESCE(SUM(l.salary_deduction), 0) AS deductions,
         (e.monthly_salary - COALESCE(SUM(l.salary_deduction), 0)) AS net_pay
  FROM employees e
  LEFT JOIN leaves l
    ON e.id = l.employee_id
   AND (
        -- Leave starts in the same year+month
        (EXTRACT(YEAR FROM l.start_date) = $1::int AND EXTRACT(MONTH FROM l.start_date) = $2::int)
        OR
        (EXTRACT(YEAR FROM l.end_date) = $1::int AND EXTRACT(MONTH FROM l.end_date) = $2::int)
        OR
        -- Leave spans across the whole month
        (l.start_date <= make_date($1::int, $2::int, 1)
         AND l.end_date >= (make_date($1::int, $2::int, 1) + interval '1 month - 1 day'))
      )
  WHERE e.id = $3::int
  GROUP BY e.id, e.full_name, e.role, e.monthly_salary;
`;

    const result = await pool.query(query, [year, month, employeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payslip not found" });
    }

    const data = result.rows[0];

    // Set headers for file download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=payslip-${month}-${year}.pdf`
    );

    // Generate PDF
    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(18).text(`Payslip - ${month}/${year}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Employee Name: ${data.full_name}`);
    doc.text(`Designation: ${data.role}`); // fixed field name (your table has 'role')
    doc.text(`Basic Salary: ${data.monthly_salary}`);
    doc.text(`Deductions: ${data.deductions}`);
    doc.moveDown();
    doc.fontSize(14).text(`Net Pay: ${data.net_pay}`, { underline: true });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
