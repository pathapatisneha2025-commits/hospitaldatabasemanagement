const express = require('express');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const pool = require("../../db"); 

const router = express.Router();

// Simple in-memory counter (resets when server restarts)
// For production, store in DB
let invoiceCounter = 1;

// Function to generate invoice number
function generateInvoiceNo() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const datePart = `${yyyy}${mm}${dd}`;
  const counterPart = String(invoiceCounter).padStart(3, '0'); // e.g., 001, 002
  invoiceCounter++;

  return `INV${datePart}-${counterPart}`;
}

// POST: Generate Invoice
router.post('/generate', (req, res) => {
  const invoiceData = req.body;

  // Auto-generate invoiceNo
  const invoiceNo = generateInvoiceNo();
  invoiceData.invoiceNo = invoiceNo;

  // Ensure invoices folder exists
  const invoicesDir = path.join(__dirname, '../invoices');
  if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir);
  }
  const filePath = path.join(invoicesDir, `Invoice-${invoiceNo}.pdf`);

  // Create PDF document
  const doc = new PDFDocument({ margin: 30 });
  doc.pipe(fs.createWriteStream(filePath));

  // Title
  doc.fontSize(20).text('Medicine Store Invoice', { align: 'center' });
  doc.moveDown();

  // Invoice & patient info
  doc.fontSize(12).text(`Invoice No: ${invoiceData.invoiceNo}`);
  doc.text(`Date: ${invoiceData.date || new Date().toLocaleDateString()}`);
  doc.text(`Patient Name: ${invoiceData.patientName}`);
  doc.text(`Patient Age: ${invoiceData.patientAge || 'N/A'}`);
  doc.text(`Patient Phone: ${invoiceData.patientPhone || 'N/A'}`);
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
  invoiceData.medicines.forEach(med => {
    doc.text(med.name, itemX, rowY);
    doc.text(med.qty, qtyX, rowY);
    doc.text(med.unitPrice, priceX, rowY);
    doc.text(med.total, totalX, rowY);
    rowY += 20;
  });

  // Totals
  doc.moveDown(2);
  doc.text(`Subtotal: ${invoiceData.subtotal}`, { align: 'right' });
  doc.text(`Discount: ${invoiceData.discount}`, { align: 'right' });
  doc.text(`Tax: ${invoiceData.tax}`, { align: 'right' });
  doc.text(`Grand Total: ${invoiceData.grandTotal}`, { align: 'right' });
  doc.text(`Payment Mode: ${invoiceData.paymentMode}`, { align: 'right' });

  doc.end();

  // Send file as response after creation
  doc.on('finish', () => {
    res.download(filePath, (err) => {
      if (err) console.error('Download error:', err);
    });
  });
});

module.exports = router;
