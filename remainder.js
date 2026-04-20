const cron = require("node-cron");
const db = require("./db");
const SendEmail = require("./utils/SenEmail");
const QRCode = require("qrcode");

function startReminderJob() {
  console.log("🟢 Cron initialized");

  // ✅ Runs every day at 6:00 PM IST
  cron.schedule("0 18 * * *", async () => {
    console.log("🔔 Running 1-day-before 6PM reminder:", new Date());

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
        if (!appt.patientemail) continue;

        const qrImage = await QRCode.toDataURL(
          appt.qr_data || JSON.stringify({
            token: appt.tokenid,
            name: appt.name,
            doctorName: appt.doctorname,
            date: appt.date,
            time: appt.timeslot,
          })
        );

        await SendEmail({
          to: appt.patientemail,
          subject: `⏰ Reminder: Appointment Tomorrow`,
          html: `
            <div style="font-family:Arial;text-align:center">

              <h2>⏰ Reminder</h2>

              <p>Dear ${appt.name}</p>

              <p>Your appointment is scheduled for TOMORROW</p>

              <h3>👨‍⚕️ Dr ${appt.doctorname}</h3>
              <p><b>Date:</b> ${appt.date}</p>
              <p><b>Time:</b> ${appt.timeslot}</p>
              <p><b>Token:</b> ${appt.tokenid}</p>

              <h3>📱 QR Code</h3>
              <img src="${qrImage}" style="width:180px" />

              <p style="color:gray;margin-top:10px">
                Please arrive 10–15 minutes early.
              </p>
            </div>
          `,
        });

        await db.query(
          `UPDATE appointments 
           SET reminder_sent = true 
           WHERE id = $1`,
          [appt.id]
        );

        console.log("✅ Sent:", appt.patientemail);
      }

      console.log("✅ Reminder job completed");
    } catch (err) {
      console.error("❌ Reminder error:", err.message);
    }
  }, {
    timezone: "Asia/Kolkata"
  });
}

module.exports = startReminderJob;