const express = require("express");
const pool = require("../db"); // PostgreSQL connection
const PDFDocument = require("pdfkit");
const axios = require("axios");
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

    // 1️⃣ Fetch employee info + deductions + bank details + image
    const query = `
      SELECT e.id,
             e.full_name,
             e.role,
             e.monthly_salary,
             e.ifsc,
             e.branch_name,
             e.bank_name,
             e.account_number,
             e.image,
             COALESCE(l.salary_deduction, 0) AS deductions
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT l.salary_deduction
        FROM leaves l
        WHERE l.employee_id = e.id
          AND (
            (EXTRACT(YEAR FROM l.start_date) = $1::int AND EXTRACT(MONTH FROM l.start_date) = $2::int)
            OR
            (EXTRACT(YEAR FROM l.end_date) = $1::int AND EXTRACT(MONTH FROM l.end_date) = $2::int)
            OR
            (l.start_date <= make_date($1::int, $2::int, 1)
             AND l.end_date >= (make_date($1::int, $2::int, 1) + interval '1 month - 1 day'))
          )
        ORDER BY l.id DESC
        LIMIT 1
      ) l ON TRUE
      WHERE e.id = $3::int;
    `;
    const result = await pool.query(query, [year, month, employeeId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payslip not found" });
    }

    const employee = result.rows[0];
    const baseSalary = Number(employee.monthly_salary) || 0;
    const deductions = Number(employee.deductions) || 0;

    // 2️⃣ Fetch maximum monthly hours from attendance
    const monthRes = await pool.query(
      `SELECT MAX(monthly_hours) AS max_monthly_hours
       FROM attendance
       WHERE employee_id = $1
         AND EXTRACT(YEAR FROM timestamp) = $2
         AND EXTRACT(MONTH FROM timestamp) = $3`,
      [employeeId, year, month]
    );
    const monthlyHoursText = monthRes.rows[0]?.max_monthly_hours || "0 hrs 0 mins";

    // Helper to convert "X hrs Y mins" → decimal hours
    function parseHoursText(hoursText) {
      const match = hoursText.match(/(\d+)\s*hrs?\s*(\d+)?\s*mins?/i);
      if (!match) return 0;
      const hrs = parseInt(match[1], 10);
      const mins = parseInt(match[2] || 0, 10);
      return hrs + mins / 60;
    }

    const monthlyHours = parseHoursText(monthlyHoursText);

    // 3️⃣ Proportional Incentive
    const expectedHours = 270; // set your monthly expected hours
    let proportionalIncentive = 0;
    if (monthlyHours > expectedHours) {
      proportionalIncentive = (baseSalary / expectedHours) * monthlyHours;
    }

   

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

    // 5️⃣ Late penalty
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
    const latedays = lateRows.length;

    let perLatePenalty = 0;
    if (baseSalary >= 4500 && baseSalary <= 7500) perLatePenalty = 25;
    else if (baseSalary >= 7501 && baseSalary <= 9500) perLatePenalty = 50;
    else if (baseSalary >= 9501) perLatePenalty = 75;

    const latePenalty = totalBlocks * perLatePenalty;

    // 6️⃣ Net Pay
    const netPay = Math.max(
      0,
      baseSalary + proportionalIncentive - unauthorizedPenaltyTotal - latePenalty - deductions
    );

    // 7️⃣ Preload employee image buffer
    let employeeImageBuffer = null;
    if (employee.image) {
      try {
        if (employee.image.startsWith("http")) {
          const response = await axios.get(employee.image, { responseType: "arraybuffer" });
          employeeImageBuffer = Buffer.from(response.data);
        } else {
          employeeImageBuffer = employee.image;
        }
      } catch (err) {
        console.warn("Image load failed:", err.message);
      }
    }

    // 8️⃣ Generate PDF
    const doc = new PDFDocument();
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=payslip-${employeeId}-${month}-${year}.pdf`,
        "Content-Length": pdfData.length
      }).end(pdfData);
    });

    doc.fontSize(18).text(`Payslip - ${month}/${year}`, { align: "center" });
    doc.moveDown();

    if (employeeImageBuffer) doc.image(employeeImageBuffer, doc.page.width - 120, 15, { width: 100, height: 100 });

    doc.fontSize(12).text(`Employee Name: ${employee.full_name}`);
    doc.text(`Role: ${employee.role}`);
    doc.text(`Base Salary: ${baseSalary.toFixed(2)}`);
    doc.text(`Deductions (Leaves): ${deductions.toFixed(2)}`);
    doc.text(`Proportional Incentive: ${proportionalIncentive.toFixed(2)}`);
    doc.text(`Unauthorized Leaves: ${unauthorizedLeaves}`);
    doc.text(`Unauthorized Penalty: ${unauthorizedPenaltyTotal}`);
    doc.text(`Late Days: ${latedays}`);
    doc.text(`Late Blocks (after 3 free days): ${totalBlocks}`);
    doc.text(`Late Penalty: ${latePenalty}`);
    doc.moveDown();

    doc.text(`Bank: ${employee.bank_name || "N/A"}`);
    doc.text(`Branch: ${employee.branch_name || "N/A"}`);
    doc.text(`Account Number: ${employee.account_number || "N/A"}`);
    doc.text(`IFSC: ${employee.ifsc || "N/A"}`);
    doc.moveDown();

    doc.fontSize(14).text(`Net Pay: ${netPay.toFixed(2)}`, { underline: true });

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});





module.exports = router;