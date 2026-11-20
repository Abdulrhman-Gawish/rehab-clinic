// بيانات المريض المطلوبة عند تسجيل الدخول للطبيب، وكود المريض.
import type { checkinEn } from './checkin.en';

// Arabic counted nouns: 1, 2, 3-10 (plural), 11+ (singular accusative).
const counted = (n: number, one: string, two: string, few: string, many: string) =>
  n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;

export const checkinAr: typeof checkinEn = {
  checkIn: {
    title: 'بيانات المريض',
    hint: 'مطلوبة قبل دخول المريض إلى الطبيب.',
    complete: 'بيانات المريض مكتملة',
    code: 'كود المريض',
    noCode: 'يُعطى مع وثيقة الهوية',
    idType: 'وثيقة الهوية',
    idTypes: { NATIONAL_ID: 'الرقم القومي', PASSPORT: 'جواز سفر (غير مصري)' },
    nationalId: 'الرقم القومي',
    nationalIdHint: '14 رقمًا. يُملأ تاريخ الميلاد والنوع منه تلقائيًا.',
    passport: 'رقم جواز السفر',
    passportHint: 'حروف وأرقام.',
    gender: 'النوع',
    dob: 'تاريخ الميلاد',
    age: 'العمر',
    fromNationalId: 'من الرقم القومي.',
    ageHint: (age: string) => `العمر: ${age}`,
    ageText: (years: number, months: number) => {
      if (years >= 1) return counted(years, 'سنة واحدة', 'سنتان', 'سنوات', 'سنة');
      if (months >= 1) return counted(months, 'شهر واحد', 'شهران', 'أشهر', 'شهرًا');
      return 'أقل من شهر';
    },
    notes: 'ملاحظات إدارية',
    notesHint: 'لا تُكتب فيها أي معلومات طبية.',
    source: 'مصدر الإحالة',
    sourceHint: 'كيف عرف المريض العيادة. إحالة الطبيب تُسجَّل مع الطبيب وشروطها.',
    pickSource: 'اختر…',
    sourceDetails: 'تفاصيل',
    sourceDetailsPh: 'أي إعلان، أي صديق…',
    locked: 'المالك فقط يمكنه تغيير وثيقة الهوية لمريض لديه كود.',
    problems: {
      required: 'مطلوب.',
      nationalIdFormat: 'الرقم القومي 14 رقمًا.',
      nationalIdInvalid: 'رقم قومي غير صحيح (القرن أو تاريخ الميلاد).',
      passportFormat: 'من 5 إلى 20 حرفًا ورقمًا.',
      dobMismatch: 'لا يطابق الرقم القومي.',
      genderMismatch: 'لا يطابق الرقم القومي.',
      future: 'لا يمكن أن يكون في المستقبل.',
    },
    edit: 'تعديل البيانات',
    searchPh: 'الاسم أو الهاتف أو كود المريض أو رقم الهوية',
    saved: 'تم حفظ بيانات المريض',
  },
};
