const nyseTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', // NYSE timezone
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});


export function nyseTime(optionalTime) {
    let now = typeof optionalTime !== "undefined" ? new Date(optionalTime) : new Date();
    const formattedDate = nyseTimeFormatter.format(now);
    return formattedDate;
}

export function getDateXDaysYMinutesAgo(x = 0, y = 0) {
    // Get the current date and time
    const now = new Date();

    // Subtract x days (can result in previous month)
    now.setDate(now.getDate() - x);

    // Subtract y minutes (can result in previous hour or day)
    now.setMinutes(now.getMinutes() - y);

    return now;
}

// iffe invokation
// (async () => {
//     console.log(nyseTime());
// })()