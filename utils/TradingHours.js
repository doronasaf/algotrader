const config = require("../config/config.json");
// Define market hours (Eastern Time for NYSE)
const tradingConfig = {
    premarket: { enabled: true, startTime: "09:00", endTime: "14:30" }, // UTC equivalent of 4:00 AM to 9:30 AM ET
    market: { enabled: true, startTime: "14:30", endTime: "20:00" }, // UTC equivalent of 9:30 AM to 4:00 PM ET // market is open until 21:00 but i will close at 20:00
    afterHours: { enabled: true, startTime: "21:00", endTime: "01:00" }, // UTC equivalent of 4:00 PM to 8:00 PM ET
};

const ALWAYS_OPEN = config.app.tragingHours.alwaysOpen;

function isWithinTradingHours(config) {
    if (ALWAYS_OPEN) return true;
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const currentTime = utcHour * 60 + utcMinute;

    const [startHour, startMinute] = config.startTime.split(":").map(Number);
    const [endHour, endMinute] = config.endTime.split(":").map(Number);

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    return currentTime >= startTime && currentTime <= endTime;
}

module.exports = {
    isWithinTradingHours,
    tradingConfig,
};