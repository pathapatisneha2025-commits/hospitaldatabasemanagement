const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require("../../db"); 

const router = express.Router();

let invoiceCounter = 1;

// Generate invoice number
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

// POST: Generate Invoice (PDF)
router.post('/generate', async (req, res) => {
  try {
    const {
      cartIds,
      patientName,
      patientAge,
      patientPhone,
      date,
      subtotal,
      discount,
      tax,
      grandTotal,
      paymentMode
    } = req.body;

    if (!cartIds || cartIds.length === 0) {
      return res.status(400).json({ error: "Cart IDs required to generate invoice" });
    }

    // Fetch cart items with employee names, cast employeeid to int
    const cartResult = await pool.query(
      `SELECT c.*, e.full_name AS employee_name
       FROM cart c
       LEFT JOIN employees e ON c.employeeid::int = e.id
       WHERE c.id = ANY($1)`,
      [cartIds]
    );

    const cartItems = cartResult.rows;

    // Extract unique employee names
    const employeeNames = [...new Set(cartItems
      .map(item => item.employee_name)
      .filter(name => name)
    )].join(", ") || 'Unknown';

    // Generate invoice number
    const invoiceNo = generateInvoiceNo();

    // PDF headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Invoice-${invoiceNo}.pdf`);

    const doc = new PDFDocument({ margin: 30 });
    doc.pipe(res);

    // Title
    doc.fontSize(20).text('Medicine Store Invoice', { align: 'center' });
    doc.moveDown();

    // Invoice info
    doc.fontSize(12).text(`Invoice No: ${invoiceNo}`);
    doc.text(`Date: ${date || new Date().toLocaleDateString()}`);
    doc.text(`Patient Name: ${patientName}`);
    doc.text(`Patient Age: ${patientAge || 'N/A'}`);
    doc.text(`Patient Phone: ${patientPhone || 'N/A'}`);
    doc.text(`Processed By: ${employeeNames}`);
    doc.moveDown();

    // Table headers
    const tableTop = 180;
    const itemX = 50;
    const qtyX = 250;
    const priceX = 300;
    const totalX = 400;

    doc.font('Helvetica-Bold');
    doc.text('Medicine', itemX, tableTop);
    doc.text('Qty', qtyX, tableTop);
    doc.text('Unit Price', priceX, tableTop);
    doc.text('Total', totalX, tableTop);
    doc.moveTo(itemX, tableTop + 15).lineTo(500, tableTop + 15).stroke();

    // Table rows
    doc.font('Helvetica');
    let rowY = tableTop + 25;
    cartItems.forEach(item => {
      doc.text(item.name, itemX, rowY);
      doc.text(item.quantity, qtyX, rowY);
      doc.text(item.price, priceX, rowY);
      doc.text((item.price * item.quantity).toFixed(2), totalX, rowY);
      rowY += 20;
    });

    // Totals
    doc.moveDown(2);
    doc.text(`Subtotal: ${subtotal}`, { align: 'right' });
    doc.text(`Discount: ${discount}`, { align: 'right' });
    doc.text(`Tax: ${tax}`, { align: 'right' });
    doc.text(`Grand Total: ${grandTotal}`, { align: 'right' });
    doc.text(`Payment Mode: ${paymentMode}`, { align: 'right' });

    doc.end();

  } catch (error) {
    console.error("Invoice generation error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
