const express = require("express");
const pool = require("../db"); // PostgreSQL connection
const PDFDocument = require("pdfkit");

const router = express.Router();

router.get("/pdf/:year/:month/:employeeId", async (req, res) => {
  try {
    const { year, month, employeeId } = req.params;

    if (!year || !month || !employeeId) {
      return res.status(400).json({ error: "Missing required params" });
    }

  const query = `
  SELECT e.employee_full_name,
         e.role,
         e.basic_salary,
         COALESCE(SUM(l.salary_deduction), 0) AS deductions,
         (e.basic_salary - COALESCE(SUM(l.salary_deduction), 0)) AS net_pay
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
  GROUP BY e.id, e.employee_full_name, e.role, e.basic_salary;
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

    doc.fontSize(12).text(`Employee Name: ${data.employee_name}`);
    doc.text(`Designation: ${data.role}`); // fixed field name (your table has 'role')
    doc.text(`Basic Salary: ₹${data.basic_salary}`);
    doc.text(`Deductions: ₹${data.deductions}`);
    doc.moveDown();
    doc.fontSize(14).text(`Net Pay: ₹${data.net_pay}`, { underline: true });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
