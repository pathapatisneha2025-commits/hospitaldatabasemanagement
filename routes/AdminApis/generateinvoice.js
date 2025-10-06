const express = require('express');
const pool = require("../../db"); 

const router = express.Router();

let invoiceCounter = 1;

// Function to generate invoice number
function generateInvoiceNo() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const datePart = `${yyyy}${mm}${dd}`;
  const counterPart = String(invoiceCounter).padStart(3, '0');
  invoiceCounter++;
  return `INV${datePart}-${counterPart}`;
}

// 🧾 POST: Generate Invoice (JSON Response)
router.post('/generate', async (req, res) => {
  try {
    const { employeeId, patientName, patientAge, patientPhone, paymentMode } = req.body;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: "Employee ID is required" });
    }

    // Fetch full employee name
    const employeeResult = await pool.query(
      "SELECT full_name FROM employees WHERE id = $1",
      [employeeId]
    );
    const employeeName = employeeResult.rows[0]?.full_name || 'Unknown';

    // Fetch cart items for the employee
    const cartResult = await pool.query(
      `SELECT id, name, quantity, price
       FROM cart
       WHERE employeeid = $1`,
      [employeeId]
    );

    if (cartResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "No items found in cart" });
    }

    // Map cart items
    const medicines = cartResult.rows.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: parseFloat(item.price),
      total: parseFloat(item.price) * item.quantity
    }));

    // Calculate total
    const totalAmount = medicines.reduce((sum, med) => sum + med.total, 0);

    // Generate invoice number
    const invoiceNo = generateInvoiceNo();

    // Construct response data
    const invoiceData = {
      invoiceNo,
      date: new Date().toISOString(),
      patientDetails: {
        name: patientName,
        age: patientAge || 'N/A',
        phone: patientPhone || 'N/A'
      },
      generatedBy: employeeName,
      paymentMode,
      items: medicines,
      totalAmount: totalAmount.toFixed(2)
    };

  
// ✅ Send JSON response
    res.json({
      success: true,
      message: "Invoice generated successfully",
      data: invoiceData
    });

  } catch (error) {
    console.error("Invoice generation error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
