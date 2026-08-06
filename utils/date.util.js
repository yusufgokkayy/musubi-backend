// Timezone-aware tarih yardımcıları.
// Tüm "bugün" hesapları kullanıcının kendi saat dilimine göre yapılır;
// aksi halde yurt dışındaki kullanıcının günü yanlış anda başlar, streak'i haksız kırılır.
const User = require('../models/User');

const DEFAULT_TZ = 'Europe/Istanbul';

// Geçersiz timezone string'i tüm isteği patlatmasın
const safeTimezone = (tz) => {
    if (!tz) return DEFAULT_TZ;
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz });
        return tz;
    } catch {
        return DEFAULT_TZ;
    }
};

// Verilen andaki timezone offset'i (ms)
const tzOffsetMs = (timeZone, date) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUTC - date.getTime();
};

// Verilen YYYY-MM-DD gününün kullanıcının saat dilimindeki başlangıcı
// (UTC Date instant'ı olarak). Geçersiz string'de null döner.
const startOfDateInTz = (timeZone, dayStr) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr || '')) return null;
    const tz = safeTimezone(timeZone);
    const guess = new Date(dayStr + 'T00:00:00Z');
    if (isNaN(guess)) return null; // 2026-13-45 gibi takvim dışı değerler
    let result = new Date(guess.getTime() - tzOffsetMs(tz, guess));
    // DST geçiş kenarı: offset sonuçta değiştiyse bir kez düzelt
    const offset2 = tzOffsetMs(tz, result);
    if (guess.getTime() - offset2 !== result.getTime()) {
        result = new Date(guess.getTime() - offset2);
    }
    return result;
};

// Bir anın kullanıcının saat dilimindeki takvim günü ("YYYY-MM-DD").
// Kayıtları güne göre kovalara ayırmanın tek doğru yolu budur: session.date
// gerçek oluşturulma anıdır, gün başlangıcı değil.
const localDateStr = (timeZone, date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(timeZone) }).format(date);

// Kullanıcının saat diliminde bugünün başlangıcı (UTC Date instant'ı olarak)
const startOfDayInTz = (timeZone, now = new Date()) => {
    const tz = safeTimezone(timeZone);
    return startOfDateInTz(tz, localDateStr(tz, now));
};

// İçinde bulunulan TAKVİM haftasının (Pazartesi → Pazar) yedi günü,
// kullanıcının saat diliminde, "YYYY-MM-DD" dizisi olarak.
//
// Aritmetik bilerek UTC gece yarısı üzerinde `setUTCDate` ile yapılır, gerçek
// instant'lara ±24 saat eklenerek DEĞİL: yaz saati geçişinin olduğu haftada
// bir gün 23 veya 25 saattir, milisaniye toplamak o haftada bir günü atlar ya
// da tekrar eder. Takvim günü üzerinden sayınca geçiş görünmez olur.
const weekDatesInTz = (timeZone, now = new Date()) => {
    const todayStr = localDateStr(timeZone, now);
    const base = new Date(todayStr + 'T00:00:00Z');
    // getUTCDay: 0=Pazar. ISO haftası Pazartesi başladığı için kaydırılır.
    base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));

    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
    });
};

const addDays = (date, n) => new Date(date.getTime() + n * 24 * 60 * 60 * 1000);

// Kullanıcının saat dilimindeki yerel saat (0-23)
const localHourInTz = (timeZone, now = new Date()) => {
    const tz = safeTimezone(timeZone);
    return parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', hour12: false
    }).format(now), 10) % 24;
};

// Kullanıcının saat dilimindeki gece yarısından beri geçen dakika (0-1439).
// Hatırlatma saati HH:mm olduğu için saat çözünürlüğü yetmiyor.
const localMinutesInTz = (timeZone, now = new Date()) => {
    const tz = safeTimezone(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(now);
    const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
    return (get('hour') % 24) * 60 + get('minute');
};

// "HH:mm" -> gece yarısından beri dakika; biçim bozuksa null
const parseHHmm = (value) => {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

// Kullanıcıyı çekip onun bugün-başlangıcını döndürür (en sık kullanılan kalıp)
const startOfTodayForUser = async (userId) => {
    const user = await User.findById(userId).select('timezone');
    return startOfDayInTz(user?.timezone);
};

module.exports = { DEFAULT_TZ, safeTimezone, startOfDayInTz, startOfDateInTz, localDateStr, weekDatesInTz, addDays, localHourInTz, localMinutesInTz, parseHHmm, startOfTodayForUser };
