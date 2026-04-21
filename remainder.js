const cron = require("node-cron");
const db = require("./db");
const QRCode = require("qrcode");
const transporter = require("./utils/transpotar");

function startReminderJob() {
  console.log("🟢 Cron initialized (TEST MODE)");

  // ⏱️ 1 MINUTE TEST (change later)
  cron.schedule(
    "*/1 * * * *",
    async () => {
      console.log("🔔 Running reminder job:", new Date());

      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const date = tomorrow.toISOString().split("T")[0];

        const result = await db.query(
          `SELECT * FROM appointments 
           WHERE DATE(date) = $1 
           AND (reminder_sent IS NULL OR reminder_sent = false)`,
          [date]
        );

        console.log("📊 Found:", result.rows.length);

       for (let appt of result.rows) {
  try {
    console.log("📨 Processing:", appt.patientemail);

    if (!appt.patientemail) {
      console.log("❌ Missing email for:", appt.id);
      continue;
    }

    if (!appt.qrdata) {
      console.log("❌ Missing QR data for:", appt.id);
      continue;
    }

    // QR generate
    const qrImage = await QRCode.toDataURL(appt.qrdata, {
      width: 300,
      margin: 2,
    });

    const qrBuffer = Buffer.from(qrImage.split(",")[1], "base64");

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: appt.patientemail,
      subject: "⏰ Appointment Reminder",

      attachments: [
        {
          filename: "qr.png",
          content: qrBuffer,
          cid: "qrimage@pams",
        },
      ],

      html: `
        <div style="text-align:center;font-family:Arial">
          <h2>⏰ Reminder</h2>

          <p>Dear <b>${appt.name}</b></p>

          <p>Doctor: ${appt.doctorname}</p>
          <p>Date: ${appt.date}</p>
          <p>Token: ${appt.tokenid}</p>

          <h3>QR Code</h3>
          <img src="cid:qrimage@pams" width="180"/>

        </div>
      `,
    });

    console.log("✅ EMAIL SENT TO:", appt.patientemail);

    await db.query(
      `UPDATE appointments SET reminder_sent = true WHERE id = $1`,
      [appt.id]
    );

  } catch (err) {
    console.log("❌ EMAIL FAILED:", appt.patientemail, err.message);
  }
}
        console.log("✅ Reminder job completed");
      } catch (err) {
        console.error("❌ Reminder error:", err.message);
      }
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

module.exports = startReminderJob;