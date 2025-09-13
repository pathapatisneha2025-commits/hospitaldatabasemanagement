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
    if (!year || !month || !employeeId) {
      return res.status(400).json({ error: "Missing required params" });
    }

    // 1️⃣ Full employee info + deductions + bank details + image
    const query = `
      SELECT e.full_name,
             e.role,
             e.monthly_salary,
             e.ifsc,
             e.branch_name,
             e.bank_name,
             e.account_number,
             e.image,
             COALESCE(SUM(l.salary_deduction), 0) AS deductions
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
      WHERE e.id = $3::int
      GROUP BY e.id, e.full_name, e.role, e.monthly_salary,
               e.ifsc, e.branch_name, e.bank_name, e.account_number, e.image;
    `;
    const result = await pool.query(query, [year, month, employeeId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payslip not found" });
    }

    const employee = result.rows[0];

    // Convert salary and deductions to numbers
    const baseSalary = Number(employee.monthly_salary) || 0;
    const deductions = Number(employee.deductions) || 0;

    // 2️⃣ Total working hours (On Duty → Off Duty)
    const hoursResult = await pool.query(
      `SELECT 
          SUM(EXTRACT(EPOCH FROM (next_time - timestamp)) / 3600) AS total_hours
       FROM (
          SELECT 
            a.timestamp,
            a.status,
            LEAD(a.timestamp) OVER (
              PARTITION BY DATE(a.timestamp) ORDER BY a.timestamp
            ) AS next_time,
            LEAD(a.status) OVER (
              PARTITION BY DATE(a.timestamp) ORDER BY a.timestamp
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
    const totalHours = Number(hoursResult.rows[0]?.total_hours) || 0;

    // 3️⃣ Proportional incentive (expected 270 hrs)
    const expectedHours = 270;
    const proportionalIncentive = (baseSalary / expectedHours) * totalHours;

    // 4️⃣ Unauthorized leave penalty
    let unauthorizedLeaves = 0;
    let unauthorizedPenaltyTotal = 0;

    const cancelledLeaves = await pool.query(
      `SELECT start_date, end_date, leave_type
       FROM leaves
       WHERE employee_id = $1
         AND status ILIKE 'cancelled'
         AND (
            (EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) = $3)
            OR
            (EXTRACT(YEAR FROM end_date) = $2 AND EXTRACT(MONTH FROM end_date) = $3)
         )`,
      [employeeId, year, month]
    );

    let unauthorizedPenaltyPerLeave = 0;
    if (baseSalary >= 4500 && baseSalary <= 7500) unauthorizedPenaltyPerLeave = 35;
    else if (baseSalary >= 7501 && baseSalary <= 9500) unauthorizedPenaltyPerLeave = 70;
    else if (baseSalary >= 9501) unauthorizedPenaltyPerLeave = 105;

    for (let leave of cancelledLeaves.rows) {
      if (leave.leave_type.toLowerCase() === "halfday") unauthorizedLeaves += 0.5;
      else {
        const attResult = await pool.query(
          `SELECT COUNT(*) AS off_duty_days
           FROM attendance
           WHERE employee_id = $1
             AND status ILIKE 'Absent'
             AND timestamp::date BETWEEN $2::date AND $3::date`,
          [employeeId, leave.start_date, leave.end_date]
        );
        unauthorizedLeaves += parseInt(attResult.rows[0].off_duty_days, 10) || 0;
      }
    }
    unauthorizedPenaltyTotal = unauthorizedLeaves * unauthorizedPenaltyPerLeave;

    // 5️⃣ Late penalty (first 3 late days free)
    const lateResult = await pool.query(
      `SELECT DATE(a.timestamp) AS day,
       FLOOR(EXTRACT(EPOCH FROM (MIN(a.timestamp)::time - e.schedule_in)) / 300) AS blocks
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

    const lateRows = lateResult.rows || [];
    lateRows.sort((a, b) => new Date(a.day) - new Date(b.day));

    let totalBlocks = 0;
    lateRows.forEach((row, idx) => { if (idx >= 3) totalBlocks += parseInt(row.blocks, 10) || 0; });

    let perLatePenalty = 0;
    if (baseSalary >= 4500 && baseSalary <= 7500) perLatePenalty = 25;
    else if (baseSalary >= 7501 && baseSalary <= 9500) perLatePenalty = 50;
    else if (baseSalary >= 9501) perLatePenalty = 75;

    const latePenalty = totalBlocks * perLatePenalty;

    // 6️⃣ Net Pay
    const netPay = Math.max(
      0,
      baseSalary + proportionalIncentive - unauthorizedPenaltyTotal - latePenalty
    );

    // 7️⃣ Generate PDF
    const doc = new PDFDocument();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=payslip-${employeeId}-${month}-${year}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).text(`Payslip - ${month}/${year}`, { align: "center" });
    doc.moveDown();

    // Employee info
    doc.fontSize(12).text(`Employee Name: ${employee.full_name}`);
    doc.text(`Role: ${employee.role}`);
    doc.text(`Base Salary: ${baseSalary.toFixed(2)}`);
    doc.text(`Deductions (Leaves): ${deductions.toFixed(2)}`);
    doc.text(`Total Hours Worked: ${totalHours.toFixed(2)} hrs`);
    doc.text(`Proportional Incentive: ${proportionalIncentive.toFixed(2)}`);
    doc.text(`Unauthorized Leaves: ${unauthorizedLeaves}`);
    doc.text(`Unauthorized Penalty: ${unauthorizedPenaltyTotal}`);
    doc.text(`Late Blocks (after 3 free days): ${totalBlocks}`);
    doc.text(`Late Penalty: ${latePenalty}`);
    doc.moveDown();

    // Bank info
    doc.text(`Bank: ${employee.bank_name || "N/A"}`);
    doc.text(`Branch: ${employee.branch_name || "N/A"}`);
    doc.text(`Account Number: ${employee.account_number || "N/A"}`);
    doc.text(`IFSC: ${employee.ifsc || "N/A"}`);
    doc.moveDown();

    // Net Pay
    doc.fontSize(14).text(`Net Pay: ${netPay.toFixed(2)}`, { underline: true });

    // Employee image
    if (employee.image) {
      try {
        if (employee.image.startsWith("http")) {
          const response = await axios.get(employee.image, { responseType: "arraybuffer" });
          doc.image(Buffer.from(response.data), { fit: [100, 100], align: "center" });
        } else {
          doc.image(employee.image, { fit: [100, 100], align: "center" });
        }
      } catch (err) {
        console.warn("Image load failed:", err.message);
      }
    }

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});





module.exports = router;
