const cron = require("node-cron");
const db = require("./db");
const SendEmail = require("./utils/SenEmail");

function startReminderJob() {
  cron.schedule("45 18 * * *", async () => {
    console.log("🔔 Running 1-day reminder job...");

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const date = tomorrow.toISOString().split("T")[0];

      const result = await db.query(
        `SELECT * FROM appointments WHERE date = $1`,
        [date]
      );

      for (let appt of result.rows) {
        if (!appt.patientemail) continue;

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
  });
}

module.exports = startReminderJob;