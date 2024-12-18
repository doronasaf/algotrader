const nyseTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', // NYSE timezone
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});


export function nyseTime() {
    const now = new Date();
    const formattedDate = nyseTimeFormatter.format(now);
    return formattedDate;
}

// iffe invokation
// (async () => {
//     console.log(nyseTime());
// })()