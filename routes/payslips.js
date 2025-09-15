const express = require("express");
const pool = require("../db"); // PostgreSQL connection
const PDFDocument = require("pdfkit");
require("pdfkit-table"); // pdfkit-table patches PDFDocument, no need to assign
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

    // 🔹 Query employee data
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
    const baseSalary = Number(employee.monthly_salary) || 0;
    const deductions = Number(employee.deductions) || 0;

    // 🔹 Monthly hours
    const monthRes = await pool.query(
      `SELECT monthly_hours
       FROM attendance
       WHERE employee_id = $1
         AND EXTRACT(YEAR FROM timestamp) = $2
         AND EXTRACT(MONTH FROM timestamp) = $3
       ORDER BY timestamp DESC
       LIMIT 1`,
      [employeeId, year, month]
    );
    const monthlyHours = parseFloat(monthRes.rows[0]?.monthly_hours || 0);

    // 🔹 Incentive logic
    const expectedHours = 270;
    let proportionalIncentive = 0;
    if (monthlyHours > expectedHours) {
      proportionalIncentive = (baseSalary / expectedHours) * monthlyHours;
    }

    // 🔹 Unauthorized Leaves
    const unauthorizedRes = await pool.query(
      `SELECT COUNT(*) AS unauthorized_leaves
       FROM leaves
       WHERE employee_id = $1
         AND status ILIKE 'unauthorized'
         AND (
            (EXTRACT(YEAR FROM start_date) = $2::int AND EXTRACT(MONTH FROM start_date) = $3::int)
            OR
            (EXTRACT(YEAR FROM end_date) = $2::int AND EXTRACT(MONTH FROM end_date) = $3::int)
            OR
            (start_date <= make_date($2::int, $3::int, 1)
             AND end_date >= (make_date($2::int, $3::int, 1) + interval '1 month - 1 day'))
          )`,
      [employeeId, year, month]
    );
    const unauthorizedLeaves = Number(unauthorizedRes.rows[0]?.unauthorized_leaves || 0);

    const unauthorizedPenaltyPerDay = baseSalary / 30;
    const unauthorizedPenaltyTotal = unauthorizedLeaves * unauthorizedPenaltyPerDay;

    const latePenalty = 0;

    const netPay = Math.max(
      0,
      baseSalary + proportionalIncentive - deductions - unauthorizedPenaltyTotal - latePenalty
    );

    // 🔹 Generate PDF
    const doc = new PDFDocument({ margin: 30, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=payslip-${employeeId}-${month}-${year}.pdf`
    );
    doc.pipe(res);

    // Header
    doc.fontSize(18).text(`Payslip - ${month}/${year}`, { align: "center" });

    // Employee photo (top-right)
    if (employee.image) {
      try {
        if (employee.image.startsWith("http")) {
          const response = await axios.get(employee.image, { responseType: "arraybuffer" });
          doc.image(Buffer.from(response.data), doc.page.width - 150, 40, { fit: [100, 100] });
        } else {
          doc.image(employee.image, doc.page.width - 150, 40, { fit: [100, 100] });
        }
      } catch (err) {
        console.warn("Image load failed:", err.message);
      }
    }

    doc.moveDown(5);

    // 🔹 Single Combined Table
    const combinedTable = {
      headers: ["Description", "Amount / Details"],
      rows: [
        ["Employee Name", employee.full_name],
        ["Role", employee.role],
        ["Bank", employee.bank_name || "N/A"],
        ["Branch", employee.branch_name || "N/A"],
        ["Account Number", employee.account_number || "N/A"],
        ["IFSC", employee.ifsc || "N/A"],
        ["Base Salary", baseSalary.toFixed(2)],
        ["Deductions (Leaves)", deductions.toFixed(2)],
        ["Monthly Hours", monthlyHours.toFixed(2)],
        ["Expected Hours", expectedHours],
        ["Proportional Incentive", proportionalIncentive.toFixed(2)],
        ["Unauthorized Leaves", unauthorizedLeaves],
        ["Unauthorized Penalty", unauthorizedPenaltyTotal.toFixed(2)],
        ["Late Penalty", latePenalty.toFixed(2)],
        ["Net Pay", netPay.toFixed(2)],
      ],
    };

    await doc.table(combinedTable, {
      prepareHeader: () => doc.font("Helvetica-Bold"),
      prepareRow: (row, i) => doc.font("Helvetica").fontSize(12),
      padding: 5,
      columnSpacing: 15,
      width: doc.page.width - 60,
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



module.exports = router;
