const express = require("express");
const pool = require("../db"); // PostgreSQL connection
const PDFDocument = require("pdfkit");
const axios = require("axios");
const router = express.Router();

router.get("/all", async (req, res) => {
  try {
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const today = new Date(now);
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    const expectedHours = 270;
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    let totalWorkingDays = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0) totalWorkingDays++; // exclude Sundays
    }

    const employeesRes = await pool.query(`SELECT * FROM employees`);
    const employees = employeesRes.rows;
    const payslipData = [];

    for (const employee of employees) {
      const employeeId = employee.id;
      const baseSalary = Number(employee.monthly_salary) || 0;

      const deductionResult = await pool.query(
        `SELECT COALESCE(salary_deduction, 0) AS deductions
         FROM leaves
         WHERE employee_id = $1
           AND (
             (EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) = $3)
             OR
             (EXTRACT(YEAR FROM end_date) = $2 AND EXTRACT(MONTH FROM end_date) = $3)
           )
         ORDER BY id DESC
         LIMIT 1`,
        [employeeId, year, month]
      );
      const deductions = Number(deductionResult.rows[0]?.deductions || 0);

      const monthRes = await pool.query(
        `SELECT MAX(monthly_hours) AS max_monthly_hours
         FROM attendance
         WHERE employee_id = $1
           AND EXTRACT(YEAR FROM timestamp) = $2
           AND EXTRACT(MONTH FROM timestamp) = $3`,
        [employeeId, year, month]
      );
      const monthlyHoursText = monthRes.rows[0]?.max_monthly_hours || "0 hrs 0 mins";
      const match = monthlyHoursText.match(/(\d+)\s*hrs?\s*(\d+)?\s*mins?/i);
      const monthlyHours = match
        ? parseInt(match[1], 10) + (parseInt(match[2] || 0, 10) / 60)
        : 0;

      const overtimeHours = Math.max(0, monthlyHours - expectedHours);
      const proportionalIncentive =
        monthlyHours > expectedHours ? (baseSalary / expectedHours) * monthlyHours : 0;

      const deductionConfig = await pool.query(
        `SELECT unauthorized_penalty FROM employee_leavededuction WHERE employee_id = $1 LIMIT 1`,
        [employeeId]
      );
      const unauthorizedPenaltyPerLeave = deductionConfig.rows[0]?.unauthorized_penalty || 0;

      const latePenaltyConfig = await pool.query(
        `SELECT penalty_amount FROM latepenalties WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [employeeId]
      );
      const perLatePenalty = parseFloat(latePenaltyConfig.rows[0]?.penalty_amount) || 0;

      const netPay = Math.max(
        0,
        baseSalary + proportionalIncentive - deductions - unauthorizedPenaltyPerLeave - perLatePenalty
      );

      payslipData.push({
        employeeId: employeeId,
        employee: employee.full_name,
        designation: employee.role,
        basicsalary: baseSalary,
        deductions,
        net_pay: netPay,
        month,
        year,
        date: `${month}/${year}`,
        status: "pending",
        pdfUrl: `https://hospitaldatabasemanagement.onrender.com/payslips/${employeeId}.pdf`,
      });
    }

    res.json(payslipData);
  } catch (err) {
    console.error("Error generating payslip data:", err);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/all/pdf", async (req, res) => {
  try {
    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const today = new Date(now);
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    const expectedHours = 270; // fixed
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let totalWorkingDays = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0) totalWorkingDays++; // exclude Sundays
    }

    const employeesRes = await pool.query(`SELECT * FROM employees`);
    const employees = employeesRes.rows;

    const doc = new PDFDocument({ autoFirstPage: false });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=all_payslips-${month}-${year}.pdf`,
        "Content-Length": pdfData.length,
      }).end(pdfData);
    });

    for (const employee of employees) {
      const employeeId = employee.id;
      const baseSalary = Number(employee.monthly_salary) || 0;

      // Deductions
      const deductionResult = await pool.query(
        `SELECT COALESCE(salary_deduction, 0) AS deductions
         FROM leaves
         WHERE employee_id = $1
           AND (
             (EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) = $3)
             OR
             (EXTRACT(YEAR FROM end_date) = $2 AND EXTRACT(MONTH FROM end_date) = $3)
           )
         ORDER BY id DESC
         LIMIT 1`,
        [employeeId, year, month]
      );
      const deductions = Number(deductionResult.rows[0]?.deductions || 0);

      // Monthly hours
      const monthRes = await pool.query(
        `SELECT MAX(monthly_hours) AS max_monthly_hours
         FROM attendance
         WHERE employee_id = $1
           AND EXTRACT(YEAR FROM timestamp) = $2
           AND EXTRACT(MONTH FROM timestamp) = $3`,
        [employeeId, year, month]
      );
      const monthlyHoursText = monthRes.rows[0]?.max_monthly_hours || "0 hrs 0 mins";
      const parseHoursText = (text) => {
        const match = text.match(/(\d+)\s*hrs?\s*(\d+)?\s*mins?/i);
        if (!match) return 0;
        return parseInt(match[1], 10) + (parseInt(match[2] || 0, 10) / 60);
      };
      const monthlyHours = parseHoursText(monthlyHoursText);

      // Overtime hours
      const overtimeHours = Math.max(0, monthlyHours - expectedHours);

      // Proportional incentive
      const proportionalIncentive = monthlyHours > expectedHours ? (baseSalary / expectedHours) * monthlyHours : 0;

      // Unauthorized leave penalty
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

      const deductionConfig = await pool.query(
        `SELECT deduction_per_day, unauthorized_penalty
         FROM employee_leavededuction
         WHERE employee_id = $1
         LIMIT 1`,
        [employeeId]
      );
      const unauthorizedPenaltyPerLeave = deductionConfig.rows[0]?.unauthorized_penalty || 0;

      for (const leave of cancelledLeaves.rows) {
        const type = leave.leave_type?.toLowerCase();
        if (["firsthalf", "secondhalf"].includes(type)) unauthorizedLeaves += 0.5;
        else {
          const attResult = await pool.query(
            `SELECT COUNT(*) AS off_duty_days
             FROM attendance
             WHERE employee_id = $1
               AND status ILIKE 'Absent'
               AND timestamp::date BETWEEN $2::date AND $3::date`,
            [employeeId, leave.start_date, leave.end_date]
          );
          unauthorizedLeaves += parseInt(attResult.rows[0]?.off_duty_days || 0, 10);
        }
      }
      unauthorizedPenaltyTotal = unauthorizedLeaves * unauthorizedPenaltyPerLeave;

      // Late penalty
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

      const latePenaltyConfig = await pool.query(
        `SELECT penalty_amount
         FROM latepenalties 
         WHERE employee_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [employeeId]
      );
      const perLatePenalty = parseFloat(latePenaltyConfig.rows[0]?.penalty_amount) || 0;
      const latePenalty = totalBlocks * perLatePenalty;

      // Net Pay including deductions
      const netPay = Math.max(0, baseSalary + proportionalIncentive - unauthorizedPenaltyTotal - latePenalty - deductions);

      // Add new page per employee
      doc.addPage();
      doc.fontSize(18).text(`Payslip - ${month}/${year}`, { align: "center" });
      doc.moveDown();
      doc.fontSize(12)
         .text(`Employee Name: ${employee.full_name}`)
         .text(`Role: ${employee.role}`)
         .text(`Base Salary: ${baseSalary.toFixed(2)}`)
         .text(`Deductions: ${deductions.toFixed(2)}`)
         .text(`Proportional Incentive: ${proportionalIncentive.toFixed(2)}`)
         .text(`Overtime Hours: ${overtimeHours.toFixed(2)}`)
         .text(`Unauthorized Leaves: ${unauthorizedLeaves}`)
         .text(`Unauthorized Penalty: ${unauthorizedPenaltyTotal}`)
         .text(`Late Blocks (after 3 free days): ${totalBlocks}`)
         .text(`Late Penalty: ${latePenalty}`)
         .moveDown()
         .text(`Total Working Days: ${totalWorkingDays}`)
         .text(`Expected Working Hours: ${expectedHours}`)
         .text(`Monthly Hours: ${monthlyHours.toFixed(2)}`)
         .text(`Net Pay: ${netPay.toFixed(2)}`, { underline: true });
    }

    doc.end();
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
    if (!result.rows.length) {
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
    function parseHoursText(hoursText) {
      const match = hoursText.match(/(\d+)\s*hrs?\s*(\d+)?\s*mins?/i);
      if (!match) return 0;
      return parseInt(match[1], 10) + (parseInt(match[2] || 0, 10) / 60);
    }
    const monthlyHours = parseHoursText(monthlyHoursText);

    // 3️⃣ Proportional Incentive
    const expectedHours = 270;
    const proportionalIncentive = monthlyHours > expectedHours ? (baseSalary / expectedHours) * monthlyHours : 0;

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

    const deductionResult = await pool.query(
      `SELECT deduction_per_day, unauthorized_penalty
       FROM employee_leavededuction
       WHERE employee_id = $1
       LIMIT 1`,
      [employeeId]
    );
    const unauthorizedPenaltyPerLeave = deductionResult.rows[0]?.unauthorized_penalty || 0;

    for (const leave of cancelledLeaves.rows) {
      const type = leave.leave_type?.toLowerCase();
      if (["firsthalf", "secondhalf"].includes(type)) {
        unauthorizedLeaves += 0.5;
      } else {
        const attResult = await pool.query(
          `SELECT COUNT(*) AS off_duty_days
           FROM attendance
           WHERE employee_id = $1
             AND status ILIKE 'Absent'
             AND timestamp::date BETWEEN $2::date AND $3::date`,
          [employeeId, leave.start_date, leave.end_date]
        );
        unauthorizedLeaves += parseInt(attResult.rows[0]?.off_duty_days || 0, 10);
      }
    }
    unauthorizedPenaltyTotal = unauthorizedLeaves * unauthorizedPenaltyPerLeave;

    // 5️⃣ Late penalty (first 3 days free)
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
    lateRows.forEach((row, idx) => {
      if (idx >= 3) totalBlocks += parseInt(row.blocks, 10) || 0;
    });
    const latedays = lateRows.length;

    const latePenaltyResult = await pool.query(
      `SELECT penalty_amount 
       FROM latepenalties 
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [employeeId]
    );
    const perLatePenalty = parseFloat(latePenaltyResult.rows[0]?.penalty_amount) || 0;
    const latePenalty = totalBlocks * perLatePenalty;

    // 6️⃣ Break penalty (first 3 occurrences free)
    const breakResult = await pool.query(
      `SELECT b.timestamp::time AS actual_breakout, e.break_out
       FROM break_logs b
       JOIN employees e ON b.employee_id = e.id
       WHERE b.employee_id = $1
         AND b.break_type = 'Break Out'
         AND EXTRACT(YEAR FROM b.timestamp) = $2
         AND EXTRACT(MONTH FROM b.timestamp) = $3
       ORDER BY b.timestamp ASC`,
      [employeeId, year, month]
    );

    let totalBreakBlocks = 0;
    breakResult.rows.sort((a, b) => new Date(`1970-01-01T${a.actual_breakout}`) - new Date(`1970-01-01T${b.actual_breakout}`));

    breakResult.rows.forEach((row, idx) => {
      if (idx >= 3) { // only count after first 3 occurrences
        const scheduled = row.break_out;
        const actual = row.actual_breakout;

        if (actual > scheduled) {
          const diffMinutes = Math.floor(
            (new Date(`1970-01-01T${actual}`) - new Date(`1970-01-01T${scheduled}`)) / 60000
          );
          totalBreakBlocks += Math.floor(diffMinutes / 5);
        }
      }
    });

    const breakPenaltyResult = await pool.query(
      `SELECT break_penalty
       FROM breakpenalty 
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [employeeId]
    );
    const perBreakPenalty = parseFloat(breakPenaltyResult.rows[0]?.break_penalty) || 0;
    const breakPenalty = totalBreakBlocks * perBreakPenalty;

    // 7️⃣ Net Pay
    const netPay = Math.max(
      0,
      baseSalary + proportionalIncentive - unauthorizedPenaltyTotal - latePenalty - breakPenalty - deductions
    );

    // 8️⃣ Preload employee image buffer
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

    // 9️⃣ Generate PDF
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

    doc.fontSize(12)
       .text(`Employee Name: ${employee.full_name}`)
       .text(`Role: ${employee.role}`)
       .text(`Base Salary: ${baseSalary.toFixed(2)}`)
       .text(`Deductions (Leaves): ${deductions.toFixed(2)}`)
       .text(`Proportional Incentive: ${proportionalIncentive.toFixed(2)}`)
       .text(`Unauthorized Leaves: ${unauthorizedLeaves}`)
       .text(`Unauthorized Penalty: ${unauthorizedPenaltyTotal}`)
       .text(`Late Days: ${latedays}`)
       .text(`Late Blocks (after 3 free days): ${totalBlocks}`)
       .text(`Late Penalty: ${latePenalty}`)
       .text(`Break Blocks (early outs after 3 free): ${totalBreakBlocks}`)
       .text(`Break Penalty: ${breakPenalty}`)
       .moveDown()
       .text(`Bank: ${employee.bank_name || "N/A"}`)
       .text(`Branch: ${employee.branch_name || "N/A"}`)
       .text(`Account Number: ${employee.account_number || "N/A"}`)
       .text(`IFSC: ${employee.ifsc || "N/A"}`)
       .moveDown()
       .fontSize(14)
       .text(`Net Pay: ${netPay.toFixed(2)}`, { underline: true });

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});





module.exports = router;