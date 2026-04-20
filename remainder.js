const cron = require("node-cron");
const db = require("./db");
const SendEmail = require("./utils/SenEmail");

function startReminderJob() {
  console.log("🟢 Cron initialized");

  cron.schedule("0 19 * * *", async () => {
    console.log("🔔 Running reminder job at:", new Date());

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const date = tomorrow.toISOString().split("T")[0];

      const result = await db.query(
        `SELECT * FROM appointments WHERE DATE(date) = $1`,
        [date]
      );

      console.log("📊 Found:", result.rows.length);

      for (let appt of result.rows) {
        if (!appt.patientemail) continue;

        console.log("📧 Sending to:", appt.patientemail);

        await SendEmail({
          to: appt.patientemail,
          subject: `⏰ Reminder: Appointment Tomorrow`,
          html: `
            <div style="font-family:Arial;text-align:center">
              <h2>⏰ Reminder</h2>

              <p>Dear ${appt.name}</p>

              <p>Your appointment is tomorrow</p>

              <h3>👨‍⚕️ Dr ${appt.doctorname}</h3>
              <p><b>Date:</b> ${appt.date}</p>
              <p><b>Time:</b> ${appt.timeslot}</p>
              <p><b>Token:</b> ${appt.tokenid}</p>

              <p style="color:gray;margin-top:10px">
                Please arrive 10–15 minutes early.
              </p>
            </div>
          `,
        });
      }

      console.log("✅ Reminder emails sent");
    } catch (err) {
      console.error("❌ Reminder error:", err.message);
    }
  }, {
    timezone: "Asia/Kolkata" // ✅ THIS IS IMPORTANT
  });
}

module.exports = startReminderJob;