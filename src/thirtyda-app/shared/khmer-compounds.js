// Khmer words a reader reads as ONE word but a word dictionary cuts in two: Node's / iPhone's ICU (នី|មួយ|ៗ,
// ស្នងការ|ដ្ឋាន, ប្រហាក់|ប្រហែល, ទទួល|បាន, នរណា|ម្នាក់, ចុង|សប្តាហ៍, and ស្មោះ|ត្រង់ in some sentences) or Chrome's
// (much finer). Kept by hand — edit freely. shared/khmer.js never opens a line break inside one of these, in our own
// strings and in the admin's / the server's text alike, and src/scripts/thirtyda-khmer-words.mjs adds them to
// KHMER_WORDS. Write each the way our strings spell it (both ្ដ and ្ត where both are in use).
// Plain ES module, served to the browser unchanged.
export const KHMER_COMPOUNDS = Object.freeze([
  // Found cut on our pages (headless Chrome, 300–430 px).
  'នីមួយៗ', 'ស្នងការដ្ឋាន', 'អគ្គស្នងការដ្ឋាន', 'ប្រហាក់ប្រហែល', 'ទទួលបាន', 'នរណាម្នាក់',
  'ស្មោះត្រង់', 'ចុងសប្តាហ៍', 'ចុងសប្ដាហ៍', 'ចូលចិត្ត', 'សប្បាយចិត្ត', 'ក្រុមគ្រួសារ', 'ថ្ងៃចាំង',
  // Repeated words (ៗ): the word and its sign stay one.
  'អ្វីៗ', 'ងាយៗ', 'ផ្សេងៗ', 'ម្ដងៗ', 'ម្តងៗ', 'បន្តិចម្ដងៗ', 'បន្តិចម្តងៗ', 'ភ្លាមៗ', 'ជិតៗ', 'យឺតៗ',
  // Compound nouns and set phrases of our pages and the question bank.
  'ជារៀងរហូត', 'រៀងរហូត', 'ច្បាប់ចម្លង', 'លេខសម្គាល់', 'លេខកូដ', 'លេខគណនី', 'ម៉ាស៊ីនមេ', 'ម៉ាស៊ីនបកប្រែ', 'រួមទាំង',
  'នគរបាលជាតិ', 'បណ្ដាញសង្គម', 'បណ្តាញសង្គម', 'ឆ្នាំកំណើត', 'ថ្ងៃកំណើត', 'កម្មវិធីរុករក', 'ពេញវ័យ', 'មនុស្សពេញវ័យ',
  'ថ្ងៃផុតកំណត់', 'មើលមិនឃើញ', 'អានមិនបាន', 'ទុកចិត្ត', 'ពេលព្រលប់', 'ពន្លឺភ្លើង', 'ខ្សែក្រហម', 'ព័ត៌មានទំនាក់ទំនង',
  'ជួញដូរមនុស្ស', 'អាសយដ្ឋានអ៊ីនធឺណិត', 'អាសយដ្ឋានអ៊ីមែល', 'បាយល្ងាច', 'បាយព្រឹក', 'បាយថ្ងៃត្រង់', 'អាហារថ្ងៃត្រង់',
  'បើកមើល', 'ធ្វើបច្ចុប្បន្នភាព', 'ម៉ោងធ្វើការ', 'កន្លែងធ្វើការ', 'បូតជំនួយ',
  // Pairs Chrome's dictionary cuts (measured): the two halves rhyme or alliterate.
  'ស្ងប់ស្ងាត់', 'ផ្ទៀងផ្ទាត់', 'ទំនាក់ទំនង', 'ស្អប់ខ្ពើម', 'បោកប្រាស់', 'ណាត់ជួប', 'យល់ព្រម', 'រីករាយ', 'សុខសប្បាយ',
]);
