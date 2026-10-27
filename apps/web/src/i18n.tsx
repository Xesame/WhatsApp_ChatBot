import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * English and Arabic for everything firm users see (build plan: Arabic and
 * English UI with full RTL, language per user). Arabic switches the page to
 * right-to-left. Numbers use Western digits in both languages, as brokers
 * write them. The owner's admin console stays in English.
 */
export type Locale = 'en' | 'ar';

const en = {
  'app.name': 'Real Estate Bot',
  'nav.search': 'Search',
  'nav.saved': 'Saved searches',
  'nav.team': 'Team',
  'nav.admin': 'Admin console',
  'nav.signOut': 'Sign out',
  'lang.switch': 'العربية',
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.close': 'Close',
  'common.any': 'Any',
  'common.from': 'From',
  'common.to': 'To',
  'common.min': 'Min',
  'common.max': 'Max',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.unknown': 'Not stated',
  'common.egp': 'EGP',
  'common.million': 'M',
  'common.thousand': 'K',
  'common.m2': 'm²',
  'common.years': '{n} years',
  'common.error': 'Something went wrong. Try again.',
  'login.title': 'Sign in',
  'login.subtitle': 'Listings from the primary market, deduplicated and up to date',
  'login.email': 'E-mail',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.busy': 'Signing in…',
  'login.wrong': 'Wrong e-mail or password.',
  'login.tooMany': 'Too many attempts. Wait a minute and try again.',
  'login.blocked': 'Your access is paused. Contact your firm admin.',
  'password.title': 'Set your password',
  'password.reset': 'Choose a new password',
  'password.welcome': 'Welcome, {name}',
  'password.firm': 'You were added to {firm}.',
  'password.new': 'New password (at least 10 characters)',
  'password.repeat': 'Repeat the password',
  'password.differ': 'The two passwords are different.',
  'password.short': 'Use at least 10 characters.',
  'password.submit': 'Save password',
  'password.done': 'Password saved. You can sign in now.',
  'password.invalid':
    'This link has expired or was already used. Ask your firm admin for a new one.',
  'password.toLogin': 'Go to sign in',
  'search.title': 'Listings',
  'search.placeholder': 'Project, developer or area, in Arabic or English',
  'search.results': '{n} listings',
  'search.oneResult': '1 listing',
  'search.none': 'No listings match. Remove a filter to see more.',
  'search.sort': 'Sort',
  'sort.newest': 'Recently posted',
  'sort.price_asc': 'Price: low to high',
  'sort.price_desc': 'Price: high to low',
  'sort.ppsqm_asc': 'Price per m²: low to high',
  'sort.ppsqm_desc': 'Price per m²: high to low',
  'search.table': 'Table',
  'search.cards': 'Cards',
  'search.save': 'Save search',
  'search.export': 'Excel',
  'search.exportCsv': 'CSV',
  'search.filters': 'Filters',
  'search.clear': 'Clear filters',
  'search.prev': 'Previous',
  'search.next': 'Next',
  'search.page': 'Page {page} of {pages}',
  'filter.city': 'Area',
  'filter.developer': 'Developer',
  'filter.project': 'Project',
  'filter.unitType': 'Unit type',
  'filter.category': 'Category',
  'filter.bedrooms': 'Bedrooms',
  'filter.area': 'Area (m²)',
  'filter.price': 'Price (million EGP)',
  'filter.deliveryBy': 'Delivered by',
  'filter.readyToMove': 'Ready to move only',
  'filter.downPaymentMax': 'Down payment up to (%)',
  'filter.installmentYearsMin': 'Installments at least (years)',
  'filter.finishing': 'Finishing',
  'filter.priceDropped': 'Price dropped',
  'filter.status': 'Show',
  'filter.choose': 'Choose…',
  'col.listing': 'Listing',
  'col.type': 'Type',
  'col.bedrooms': 'Rooms',
  'col.area': 'Area',
  'col.price': 'Price',
  'col.ppsqm': 'Per m²',
  'col.delivery': 'Delivery',
  'col.payment': 'Payment',
  'col.seen': 'Last posted',
  'unit.readyToMove': 'Ready to move',
  'unit.priceDropped': 'Price dropped',
  'unit.usd': 'Priced in USD',
  'unit.reposted': 'Posted {n} times',
  'unit.down': '{p}% down',
  'unit.overYears': 'over {n} years',
  'unit.bedrooms': '{n} bedrooms',
  'unit.bedroom': '1 bedroom',
  'unit.bedroomsTwo': '2 bedrooms',
  'unit.from': 'from {price}',
  'listing.back': 'Back to results',
  'listing.facts': 'Details',
  'listing.payment': 'Payment plan',
  'listing.history': 'Price history',
  'listing.sources': 'Where it was posted',
  'listing.postedDeveloper': 'Developer group',
  'listing.postedBroker': 'Broker group',
  'listing.postedGroup': 'WhatsApp group',
  'listing.firstSeen': 'First posted',
  'listing.lastSeen': 'Last posted',
  'listing.fileText': 'Text read from the file',
  'listing.openFile': 'Open the file',
  'listing.notes': 'Your firm’s notes',
  'listing.notesHint': 'Only people in your firm see these.',
  'listing.addNote': 'Add a note',
  'listing.notePlaceholder': 'e.g. client Ahmed is interested; called the developer',
  'listing.share': 'Share with a client',
  'listing.usdNote': 'Converted at {rate} EGP per USD',
  'source.listing': 'Listing',
  'source.price_update': 'Price update',
  'source.sold': 'Sold notice',
  'listing.amount': 'amount {amount}',
  'listing.count': '{n} installments',
  'field.category': 'Category',
  'field.bathrooms': 'Bathrooms',
  'field.floor': 'Floor',
  'field.unitCode': 'Unit code',
  'field.finishing': 'Finishing',
  'field.land': 'Land',
  'field.garden': 'Garden',
  'field.outdoor': 'Roof / terrace',
  'field.delivery': 'Delivery',
  'field.downPayment': 'Down payment',
  'field.installments': 'Installments',
  'field.frequency': 'Paid',
  'field.maintenance': 'Maintenance',
  'field.cashDiscount': 'Cash discount',
  'field.notes': 'Notes',
  'share.title': 'Share card',
  'share.hint': 'A clean summary for your client, without the source groups.',
  'share.text': 'Text (for WhatsApp)',
  'share.image': 'Image',
  'share.download': 'Download image',
  'saved.title': 'Saved searches',
  'saved.empty': 'No saved searches yet. Search, then press “Save search”.',
  'saved.name': 'Name',
  'saved.namePlaceholder': 'e.g. 3 bedrooms New Cairo under 8M',
  'saved.alerts': 'Alerts',
  'saved.alertsSoon': 'Alerts are delivered once the chat bot is live.',
  'saved.open': 'Open',
  'saved.paused': 'Paused',
  'saved.active': 'On',
  'saved.by': 'by {name}',
  'channel.none': 'No alerts',
  'channel.whatsapp': 'WhatsApp',
  'channel.telegram': 'Telegram',
  'team.title': 'Team',
  'team.invite': 'Add an agent',
  'team.name': 'Name',
  'team.email': 'E-mail',
  'team.language': 'Language',
  'team.add': 'Add and get link',
  'team.linkReady':
    'Send this link to {name} (on WhatsApp, for example). It works once and expires on {date}.',
  'team.newLink': 'New link',
  'team.remove': 'Remove',
  'team.restore': 'Restore',
  'team.confirmRemove': 'Remove {name}? They are signed out at once.',
  'team.usage': 'Usage, last 30 days',
  'team.limit': '{n} of {max} users',
  'role.firm_admin': 'Firm admin',
  'role.agent': 'Agent',
  'role.owner': 'Owner',
  'memberStatus.invited': 'Invited',
  'memberStatus.active': 'Active',
  'memberStatus.removed': 'Removed',
  'usage.search': 'Searches',
  'usage.export': 'Exports',
  'usage.listing_view': 'Listings opened',
  'usage.chat_query': 'Chat questions',
  'status.active': 'Available',
  'status.stale': 'Not reposted lately',
  'status.sold': 'Sold',
};
export type MessageKey = keyof typeof en;

const ar: Record<MessageKey, string> = {
  'app.name': 'Real Estate Bot',
  'nav.search': 'البحث',
  'nav.saved': 'عمليات البحث المحفوظة',
  'nav.team': 'الفريق',
  'nav.admin': 'لوحة الإدارة',
  'nav.signOut': 'تسجيل الخروج',
  'lang.switch': 'English',
  'common.loading': 'جارٍ التحميل…',
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.delete': 'حذف',
  'common.copy': 'نسخ',
  'common.copied': 'تم النسخ',
  'common.close': 'إغلاق',
  'common.any': 'الكل',
  'common.from': 'من',
  'common.to': 'إلى',
  'common.min': 'من',
  'common.max': 'إلى',
  'common.yes': 'نعم',
  'common.no': 'لا',
  'common.unknown': 'غير مذكور',
  'common.egp': 'ج.م',
  'common.million': ' مليون',
  'common.thousand': ' ألف',
  'common.m2': 'م²',
  'common.years': '{n} سنوات',
  'common.error': 'حدث خطأ. حاول مرة أخرى.',
  'login.title': 'تسجيل الدخول',
  'login.subtitle': 'وحدات السوق الأولي، بدون تكرار ومحدثة باستمرار',
  'login.email': 'البريد الإلكتروني',
  'login.password': 'كلمة المرور',
  'login.submit': 'دخول',
  'login.busy': 'جارٍ الدخول…',
  'login.wrong': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'login.tooMany': 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.',
  'login.blocked': 'تم إيقاف حسابك مؤقتًا. تواصل مع مسؤول الشركة.',
  'password.title': 'اختر كلمة المرور',
  'password.reset': 'اختر كلمة مرور جديدة',
  'password.welcome': 'أهلاً {name}',
  'password.firm': 'تمت إضافتك إلى {firm}.',
  'password.new': 'كلمة مرور جديدة (10 أحرف على الأقل)',
  'password.repeat': 'أعد كتابة كلمة المرور',
  'password.differ': 'كلمتا المرور غير متطابقتين.',
  'password.short': 'استخدم 10 أحرف على الأقل.',
  'password.submit': 'حفظ كلمة المرور',
  'password.done': 'تم حفظ كلمة المرور. يمكنك تسجيل الدخول الآن.',
  'password.invalid':
    'هذا الرابط انتهت صلاحيته أو تم استخدامه. اطلب رابطًا جديدًا من مسؤول الشركة.',
  'password.toLogin': 'الذهاب لتسجيل الدخول',
  'search.title': 'الوحدات',
  'search.placeholder': 'المشروع أو المطور أو المنطقة، بالعربي أو الإنجليزي',
  'search.results': '{n} وحدة',
  'search.oneResult': 'وحدة واحدة',
  'search.none': 'لا توجد وحدات مطابقة. احذف أحد الفلاتر لرؤية المزيد.',
  'search.sort': 'الترتيب',
  'sort.newest': 'الأحدث نشرًا',
  'sort.price_asc': 'السعر: من الأقل للأعلى',
  'sort.price_desc': 'السعر: من الأعلى للأقل',
  'sort.ppsqm_asc': 'سعر المتر: من الأقل للأعلى',
  'sort.ppsqm_desc': 'سعر المتر: من الأعلى للأقل',
  'search.table': 'جدول',
  'search.cards': 'بطاقات',
  'search.save': 'حفظ البحث',
  'search.export': 'Excel',
  'search.exportCsv': 'CSV',
  'search.filters': 'الفلاتر',
  'search.clear': 'مسح الفلاتر',
  'search.prev': 'السابق',
  'search.next': 'التالي',
  'search.page': 'صفحة {page} من {pages}',
  'filter.city': 'المنطقة',
  'filter.developer': 'المطور',
  'filter.project': 'المشروع',
  'filter.unitType': 'نوع الوحدة',
  'filter.category': 'الفئة',
  'filter.bedrooms': 'عدد الغرف',
  'filter.area': 'المساحة (م²)',
  'filter.price': 'السعر (مليون ج.م)',
  'filter.deliveryBy': 'الاستلام قبل نهاية',
  'filter.readyToMove': 'استلام فوري فقط',
  'filter.downPaymentMax': 'المقدم حتى (%)',
  'filter.installmentYearsMin': 'التقسيط على الأقل (سنوات)',
  'filter.finishing': 'التشطيب',
  'filter.priceDropped': 'السعر نزل',
  'filter.status': 'عرض',
  'filter.choose': 'اختر…',
  'col.listing': 'الوحدة',
  'col.type': 'النوع',
  'col.bedrooms': 'الغرف',
  'col.area': 'المساحة',
  'col.price': 'السعر',
  'col.ppsqm': 'سعر المتر',
  'col.delivery': 'الاستلام',
  'col.payment': 'السداد',
  'col.seen': 'آخر نشر',
  'unit.readyToMove': 'استلام فوري',
  'unit.priceDropped': 'السعر نزل',
  'unit.usd': 'السعر بالدولار',
  'unit.reposted': 'اتنشرت {n} مرات',
  'unit.down': 'مقدم {p}%',
  'unit.overYears': 'على {n} سنوات',
  'unit.bedrooms': '{n} غرف',
  'unit.bedroom': 'غرفة واحدة',
  'unit.bedroomsTwo': 'غرفتين',
  'unit.from': 'يبدأ من {price}',
  'listing.back': 'العودة للنتائج',
  'listing.facts': 'التفاصيل',
  'listing.payment': 'نظام السداد',
  'listing.history': 'تاريخ السعر',
  'listing.sources': 'أين نُشرت',
  'listing.postedDeveloper': 'جروب مطور',
  'listing.postedBroker': 'جروب وسطاء',
  'listing.postedGroup': 'جروب واتساب',
  'listing.firstSeen': 'أول نشر',
  'listing.lastSeen': 'آخر نشر',
  'listing.fileText': 'النص المقروء من الملف',
  'listing.openFile': 'فتح الملف',
  'listing.notes': 'ملاحظات شركتك',
  'listing.notesHint': 'لا يراها إلا فريق شركتك.',
  'listing.addNote': 'إضافة ملاحظة',
  'listing.notePlaceholder': 'مثلاً: العميل أحمد مهتم، تم التواصل مع المطور',
  'listing.share': 'مشاركة مع عميل',
  'listing.usdNote': 'محسوب على سعر {rate} ج.م للدولار',
  'source.listing': 'إعلان',
  'source.price_update': 'تحديث سعر',
  'source.sold': 'إشعار بيع',
  'listing.amount': 'بقيمة {amount}',
  'listing.count': '{n} قسط',
  'field.category': 'الفئة',
  'field.bathrooms': 'الحمامات',
  'field.floor': 'الدور',
  'field.unitCode': 'كود الوحدة',
  'field.finishing': 'التشطيب',
  'field.land': 'مساحة الأرض',
  'field.garden': 'الحديقة',
  'field.outdoor': 'الروف / التراس',
  'field.delivery': 'الاستلام',
  'field.downPayment': 'المقدم',
  'field.installments': 'التقسيط',
  'field.frequency': 'الأقساط',
  'field.maintenance': 'الصيانة',
  'field.cashDiscount': 'خصم الكاش',
  'field.notes': 'ملاحظات',
  'share.title': 'بطاقة المشاركة',
  'share.hint': 'ملخص نظيف لعميلك، بدون أسماء الجروبات.',
  'share.text': 'نص (لواتساب)',
  'share.image': 'صورة',
  'share.download': 'تحميل الصورة',
  'saved.title': 'عمليات البحث المحفوظة',
  'saved.empty': 'لا توجد عمليات بحث محفوظة. ابحث ثم اضغط «حفظ البحث».',
  'saved.name': 'الاسم',
  'saved.namePlaceholder': 'مثلاً: 3 غرف التجمع أقل من 8 مليون',
  'saved.alerts': 'التنبيهات',
  'saved.alertsSoon': 'التنبيهات تبدأ عند تشغيل بوت المحادثة.',
  'saved.open': 'فتح',
  'saved.paused': 'متوقف',
  'saved.active': 'مفعّل',
  'saved.by': 'بواسطة {name}',
  'channel.none': 'بدون تنبيهات',
  'channel.whatsapp': 'واتساب',
  'channel.telegram': 'تيليجرام',
  'team.title': 'الفريق',
  'team.invite': 'إضافة وسيط',
  'team.name': 'الاسم',
  'team.email': 'البريد الإلكتروني',
  'team.language': 'اللغة',
  'team.add': 'إضافة واستلام الرابط',
  'team.linkReady':
    'أرسل هذا الرابط إلى {name} (على واتساب مثلاً). يعمل مرة واحدة وينتهي يوم {date}.',
  'team.newLink': 'رابط جديد',
  'team.remove': 'إزالة',
  'team.restore': 'استرجاع',
  'team.confirmRemove': 'إزالة {name}؟ سيتم تسجيل خروجه فورًا.',
  'team.usage': 'الاستخدام آخر 30 يومًا',
  'team.limit': '{n} من {max} مستخدمين',
  'role.firm_admin': 'مسؤول الشركة',
  'role.agent': 'وسيط',
  'role.owner': 'المالك',
  'memberStatus.invited': 'تمت دعوته',
  'memberStatus.active': 'نشط',
  'memberStatus.removed': 'تمت إزالته',
  'usage.search': 'عمليات بحث',
  'usage.export': 'تصدير',
  'usage.listing_view': 'وحدات تم فتحها',
  'usage.chat_query': 'أسئلة المحادثة',
  'status.active': 'متاحة',
  'status.stale': 'لم تُنشر مؤخرًا',
  'status.sold': 'مباعة',
};

/** Names of the fixed lists (from @reb/schema) in Arabic; English uses the values as they are. */
export const AR_VALUES: Record<string, string> = {
  Residential: 'سكني',
  Commercial: 'تجاري',
  Administrative: 'إداري',
  Medical: 'طبي',
  Apartment: 'شقة',
  Studio: 'ستوديو',
  Duplex: 'دوبلكس',
  Penthouse: 'بنتهاوس',
  Townhouse: 'تاون هاوس',
  'Twin House': 'توين هاوس',
  Villa: 'فيلا',
  Chalet: 'شاليه',
  Office: 'مكتب إداري',
  Retail: 'محل تجاري',
  Clinic: 'عيادة',
  'Core & Shell': 'طوب أحمر',
  'Semi-finished': 'نصف تشطيب',
  'Fully finished': 'تشطيب كامل',
  Furnished: 'مفروش',
  monthly: 'شهري',
  quarterly: 'ربع سنوي',
  'semi-annual': 'نصف سنوي',
  annual: 'سنوي',
  Percentage: 'نسبة',
  'Fixed amount': 'مبلغ ثابت',
};

const dictionaries = { en, ar };

export interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** A value from a fixed list (unit type, finishing...) in the current language. */
  value: (v: string | null | undefined) => string;
  /** "3 bedrooms", with the singular and (Arabic) dual and 11+ forms. */
  rooms: (n: number) => string;
  /** The English or Arabic name of an entity. */
  name: (n: { en: string; ar: string } | null | undefined) => string;
  number: (n: number, digits?: number) => string;
  /** Whole pounds, short: "9.8M" / "9.8 مليون". */
  money: (pounds: number | null | undefined) => string;
  /** Whole pounds, in full: "EGP 9,800,000" / "9,800,000 ج.م". */
  moneyFull: (pounds: number | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<I18n | null>(null);

export function makeI18n(locale: Locale, setLocale: (l: Locale) => void = () => undefined): I18n {
  const dict = dictionaries[locale];
  const numberFormat = (digits: number) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
      maximumFractionDigits: digits,
    });
  const t: I18n['t'] = (key, vars) =>
    dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
  return {
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    t,
    value: (v) => (v ? (locale === 'ar' ? (AR_VALUES[v] ?? v) : v) : t('common.unknown')),
    name: (n) => (n ? (locale === 'ar' ? n.ar : n.en) : t('common.unknown')),
    rooms: (n) =>
      n === 1
        ? t('unit.bedroom')
        : n === 2
          ? t('unit.bedroomsTwo')
          : locale === 'ar' && n > 10
            ? `${n} غرفة`
            : t('unit.bedrooms', { n }),
    number: (n, digits = 0) => numberFormat(digits).format(n),
    money: (pounds) => {
      if (pounds === null || pounds === undefined) return t('common.unknown');
      if (pounds >= 1_000_000)
        return `${numberFormat(pounds >= 10_000_000 ? 1 : 2).format(pounds / 1_000_000)}${t('common.million')}`;
      if (pounds >= 1_000)
        return `${numberFormat(0).format(pounds / 1_000)}${t('common.thousand')}`;
      return numberFormat(0).format(pounds);
    },
    moneyFull: (pounds) =>
      pounds === null || pounds === undefined
        ? t('common.unknown')
        : locale === 'ar'
          ? `${numberFormat(0).format(pounds)} ${t('common.egp')}`
          : `${t('common.egp')} ${numberFormat(0).format(pounds)}`,
    date: (iso) =>
      iso
        ? new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '—',
    setLocale,
  };
}

const STORAGE_KEY = 'reb.locale';
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    // storage blocked: fall through
  }
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** Provides the language and sets `lang` and `dir` on the page. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // the server keeps the signed-in user's choice anyway
    }
  };
  const value = useMemo(() => makeI18n(locale, setLocale), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Applies a language and direction to the whole page while mounted (the admin console forces English). */
export function useDocumentLanguage(locale: Locale) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
}
