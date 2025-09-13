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
            -- Leave starts in the same year+month
            (EXTRACT(YEAR FROM l.start_date) = $1::int AND EXTRACT(MONTH FROM l.start_date) = $2::int)
            OR
            (EXTRACT(YEAR FROM l.end_date) = $1::int AND EXTRACT(MONTH FROM l.end_date) = $2::int)
            OR
            -- Leave spans across the whole month
            (l.start_date <= make_date($1::int, $2::int, 1)
             AND l.end_date >= (make_date($1::int, $2::int, 1) + interval '1 month - 1 day'))
          )
              LEFT JOIN payslip_status ps
        ON e.id = ps.employee_id
       AND ps.year = $1
       AND ps.month = $2
      GROUP BY e.id, e.full_name, e.role, e.monthly_salary,ps.status
      ORDER BY e.full_name;
    `;

    const result = await pool.query(query, [year, month]);
    res.json(result.rows);
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

    // ✅ Get employee info (with bank details & image)
    const empResult = await pool.query(
      `SELECT id, name, salary, schedule_in, schedule_out,
              ifsc, branch_name, bank_name, account_number, image
       FROM employees 
       WHERE id = $1`,
      [employeeId]
    );
    if (empResult.rows.length === 0) return res.status(404).send("Employee not found");
    const employee = empResult.rows[0];

    // ✅ Total working hours (On Duty → Off Duty)
    const hoursResult = await pool.query(
      `SELECT 
          SUM(EXTRACT(EPOCH FROM (next_time - timestamp)) / 3600) AS total_hours
       FROM (
          SELECT 
            a.employee_id,
            a.timestamp,
            a.status,
            LEAD(a.timestamp) OVER (
              PARTITION BY a.employee_id, DATE(a.timestamp) 
              ORDER BY a.timestamp
            ) AS next_time,
            LEAD(a.status) OVER (
              PARTITION BY a.employee_id, DATE(a.timestamp) 
              ORDER BY a.timestamp
            ) AS next_status
          FROM attendance a
          WHERE a.employee_id = $1
            AND EXTRACT(YEAR FROM a.timestamp) = $2
            AND EXTRACT(MONTH FROM a.timestamp) = $3
       ) t
       WHERE t.status ILIKE 'On Duty'
         AND t.next_status ILIKE 'Off Duty';`,
      [employeeId, year, month]
    );

    const totalHours = hoursResult.rows[0]?.total_hours || 0;

    // ✅ Expected monthly hours (9 hrs × 30 days = 270)
    const expectedHours = 270;

    // ✅ Proportional incentive calculation
    const proportionalIncentive = (employee.salary / expectedHours) * totalHours;

    // ✅ Late penalty calculation
    const lateResult = await pool.query(
      `SELECT SUM(FLOOR(EXTRACT(EPOCH FROM (MIN(a.timestamp)::time - e.schedule_in)) / 300)) AS late_blocks
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.employee_id = $1
         AND EXTRACT(YEAR FROM a.timestamp) = $2
         AND EXTRACT(MONTH FROM a.timestamp) = $3
         AND a.status ILIKE 'On Duty'
       GROUP BY DATE(a.timestamp), e.schedule_in
       HAVING MIN(a.timestamp)::time > e.schedule_in;`,
      [employeeId, year, month]
    );

    const totalLateBlocks = lateResult.rows.reduce((sum, r) => sum + Number(r.late_blocks), 0);

    let latePenaltyPerBlock = 0;
    if (employee.salary >= 4500 && employee.salary <= 7500) latePenaltyPerBlock = 25;
    else if (employee.salary >= 7501 && employee.salary <= 9500) latePenaltyPerBlock = 50;
    else if (employee.salary >= 9501) latePenaltyPerBlock = 75;

    const latePenalty = totalLateBlocks * latePenaltyPerBlock;

    // ✅ Unauthorized leave penalty
    const leaveResult = await pool.query(
      `SELECT COUNT(DISTINCT DATE(timestamp)) AS leave_days
       FROM attendance
       WHERE employee_id = $1
         AND status ILIKE 'Absent'
         AND EXTRACT(YEAR FROM timestamp) = $2
         AND EXTRACT(MONTH FROM timestamp) = $3`,
      [employeeId, year, month]
    );

    const leaveDays = leaveResult.rows[0]?.leave_days || 0;
    const allowedLeaves = 2;
    const extraLeaves = Math.max(0, leaveDays - allowedLeaves);
    const leavePenalty = extraLeaves * (employee.salary / 30);

    // ✅ Net pay
    const netPay = employee.salary + proportionalIncentive - latePenalty - leavePenalty;

    // ✅ Generate PDF
    const doc = new PDFDocument();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=payslip_${employeeId}_${month}_${year}.pdf`
    );
    doc.pipe(res);

    // Header
    doc.fontSize(18).text("Employee Payslip", { align: "center" });
    doc.moveDown();

    // Employee basic info
    doc.fontSize(12).text(`Employee ID: ${employee.id}`);
    doc.text(`Name: ${employee.name}`);
    doc.text(`Month: ${month}-${year}`);
    doc.text(`Base Salary: ${employee.salary.toFixed(2)}`);
    doc.text(`Total Hours Worked: ${totalHours.toFixed(2)} hrs`);
    doc.text(`Incentives (Proportional): ${proportionalIncentive.toFixed(2)}`);
    doc.text(`Late Penalty: -${latePenalty.toFixed(2)}`);
    doc.text(`Leave Penalty: -${leavePenalty.toFixed(2)}`);
    doc.moveDown();

    // Bank details
    doc.fontSize(12).text(`Bank Name: ${employee.bank_name || "N/A"}`);
    doc.text(`Branch Name: ${employee.branch_name || "N/A"}`);
    doc.text(`Account Number: ${employee.account_number || "N/A"}`);
    doc.text(`IFSC Code: ${employee.ifsc || "N/A"}`);
    doc.moveDown();

    // Employee image (local path or URL)
    if (employee.image) {
      try {
        if (employee.image.startsWith("http")) {
          // If image is a URL → fetch it
          const response = await axios.get(employee.image, { responseType: "arraybuffer" });
          const imgBuffer = Buffer.from(response.data, "base64");
          doc.image(imgBuffer, { fit: [100, 100], align: "left" });
        } else {
          // If image is local file path
          doc.image(employee.image, { fit: [100, 100], align: "left" });
        }
      } catch (err) {
        console.warn("Image load failed:", err.message);
      }
    }

    doc.moveDown(2);

    // Net pay
    doc.fontSize(14).text(`Net Pay: ${netPay.toFixed(2)}`, { align: "right" });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});




module.exports = router;
