const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",

  auth: {
    user: process.env.EMAIL_USER || "yourgmail@gmail.com",
    pass: process.env.EMAIL_PASS || "your_app_password", // ⚠️ use Gmail App Password
  },

  tls: {
    rejectUnauthorized: false,
  },
});

// ✅ verify connection (optional but useful)
transporter.verify((error, success) => {
  if (error) {
    console.log("❌ Email transporter error:", error.message);
  } else {
    console.log("📧 Email transporter ready");
  }
});

module.exports = transporter;