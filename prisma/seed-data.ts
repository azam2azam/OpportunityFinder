/**
 * Reference data for the synthetic VIDA extract.
 *
 * Kept apart from seed.ts so the generator reads as logic and this reads as
 * data. Names, codes and clinical values are representative rather than real;
 * the ICD-10, LOINC and CPT codes are genuine identifiers so that the semantic
 * layer and the Ask Data templates work against realistic vocabulary.
 */

export const HOSPITALS = [
  {
    code: 'RYD',
    name: 'Riyadh Central Hospital',
    city: 'Riyadh',
    region: 'Central',
    beds: 420,
    latitude: 24.7136,
    longitude: 46.6753,
  },
  {
    code: 'JED',
    name: 'Jeddah Coastal Medical Centre',
    city: 'Jeddah',
    region: 'Western',
    beds: 310,
    latitude: 21.4858,
    longitude: 39.1925,
  },
  {
    code: 'DMM',
    name: 'Dammam Gulf Hospital',
    city: 'Dammam',
    region: 'Eastern',
    beds: 260,
    latitude: 26.4207,
    longitude: 50.0888,
  },
  {
    code: 'MED',
    name: 'Madinah Specialist Hospital',
    city: 'Madinah',
    region: 'Western',
    beds: 180,
    latitude: 24.5247,
    longitude: 39.5692,
  },
  {
    code: 'ABH',
    name: 'Abha Highland Hospital',
    city: 'Abha',
    region: 'Southern',
    beds: 150,
    latitude: 18.2465,
    longitude: 42.5117,
  },
]

export const SPECIALTIES = [
  { code: 'CARD', name: 'Cardiology', line: 'Cardiac Sciences' },
  { code: 'CTS', name: 'Cardiothoracic Surgery', line: 'Cardiac Sciences' },
  { code: 'ENDO', name: 'Endocrinology', line: 'Medical Specialties' },
  { code: 'NEPH', name: 'Nephrology', line: 'Medical Specialties' },
  { code: 'GAST', name: 'Gastroenterology', line: 'Medical Specialties' },
  { code: 'PULM', name: 'Pulmonology', line: 'Medical Specialties' },
  { code: 'NEUR', name: 'Neurology', line: 'Neurosciences' },
  { code: 'ORTH', name: 'Orthopaedics', line: 'Surgical Services' },
  { code: 'GSUR', name: 'General Surgery', line: 'Surgical Services' },
  { code: 'UROL', name: 'Urology', line: 'Surgical Services' },
  { code: 'OBGY', name: 'Obstetrics & Gynaecology', line: 'Women & Children' },
  { code: 'PAED', name: 'Paediatrics', line: 'Women & Children' },
  { code: 'ONCO', name: 'Medical Oncology', line: 'Oncology' },
  { code: 'OPHT', name: 'Ophthalmology', line: 'Ambulatory Services' },
  { code: 'DERM', name: 'Dermatology', line: 'Ambulatory Services' },
  { code: 'FMED', name: 'Family Medicine', line: 'Primary Care' },
]

export const DEPARTMENTS = [
  { code: 'OPD', name: 'Outpatient Department', costCentre: 'CC-1100' },
  { code: 'IPD', name: 'Inpatient Services', costCentre: 'CC-1200' },
  { code: 'SURG', name: 'Surgical Services', costCentre: 'CC-1300' },
  { code: 'EMRG', name: 'Emergency Department', costCentre: 'CC-1400' },
  { code: 'DIAG', name: 'Diagnostics', costCentre: 'CC-1500' },
  { code: 'WOMC', name: 'Women & Children', costCentre: 'CC-1600' },
  { code: 'ONCD', name: 'Oncology Day Unit', costCentre: 'CC-1700' },
]

/** Which department a specialty's clinics sit under. */
export const SPECIALTY_DEPARTMENT: Record<string, string> = {
  CARD: 'OPD',
  CTS: 'SURG',
  ENDO: 'OPD',
  NEPH: 'OPD',
  GAST: 'OPD',
  PULM: 'OPD',
  NEUR: 'OPD',
  ORTH: 'SURG',
  GSUR: 'SURG',
  UROL: 'SURG',
  OBGY: 'WOMC',
  PAED: 'WOMC',
  ONCO: 'ONCD',
  OPHT: 'OPD',
  DERM: 'OPD',
  FMED: 'OPD',
}

export const PAYERS = [
  { code: 'BUPA', name: 'Bupa Arabia', type: 'PRIVATE', resubmissionWindowDays: 60 },
  { code: 'TAWN', name: 'Tawuniya', type: 'PRIVATE', resubmissionWindowDays: 45 },
  { code: 'MEDG', name: 'MedGulf', type: 'PRIVATE', resubmissionWindowDays: 60 },
  { code: 'ALRA', name: 'Al Rajhi Takaful', type: 'PRIVATE', resubmissionWindowDays: 30 },
  { code: 'GOSI', name: 'GOSI Occupational Cover', type: 'GOVERNMENT', resubmissionWindowDays: 90 },
  { code: 'MOH', name: 'Ministry of Health Referral', type: 'GOVERNMENT', resubmissionWindowDays: 120 },
]

export const FIRST_NAMES_M = [
  'Abdullah', 'Mohammed', 'Ahmed', 'Khalid', 'Faisal', 'Saud', 'Omar', 'Yousef',
  'Ibrahim', 'Sultan', 'Turki', 'Nasser', 'Hamad', 'Majed', 'Bandar', 'Rayan',
  'Ziad', 'Tariq', 'Waleed', 'Salman',
]

export const FIRST_NAMES_F = [
  'Fatima', 'Noura', 'Aisha', 'Maryam', 'Sara', 'Hessa', 'Latifa', 'Reem',
  'Amal', 'Huda', 'Layla', 'Jawaher', 'Munira', 'Dalal', 'Ghada', 'Rana',
  'Shatha', 'Wafa', 'Asma', 'Bushra',
]

export const LAST_NAMES = [
  'Al-Harbi', 'Al-Qahtani', 'Al-Otaibi', 'Al-Ghamdi', 'Al-Zahrani', 'Al-Shehri',
  'Al-Dossari', 'Al-Mutairi', 'Al-Subaie', 'Al-Anazi', 'Al-Rashidi', 'Al-Amri',
  'Al-Balawi', 'Al-Juhani', 'Al-Sulami', 'Al-Maliki', 'Al-Faraj', 'Al-Nasser',
  'Al-Hakim', 'Al-Saleh',
]

export const PHYSICIAN_TITLES = ['Dr.', 'Dr.', 'Dr.', 'Prof.']

export const DISTRICTS: Record<string, string[]> = {
  Riyadh: ['Al Olaya', 'Al Malaz', 'Al Nakheel', 'Al Yasmin', 'Al Rawdah', 'Diriyah', 'Al Aziziyah'],
  Jeddah: ['Al Hamra', 'Al Rawdah', 'Al Salamah', 'Al Naeem', 'Obhur', 'Al Andalus'],
  Dammam: ['Al Faisaliyah', 'Al Shatea', 'Al Adamah', 'Al Muntazah', 'Qurtubah'],
  Madinah: ['Al Haram', 'Quba', 'Al Aqiq', 'Sultanah', 'Al Khalidiyah'],
  Abha: ['Al Sad', 'Al Manhal', 'Shamasan', 'Al Muftaha'],
}

/**
 * Laboratory catalogue. `repeatInterval` encodes the clinical monitoring
 * cadence that LAB_RECURRING_LAPSED measures against; null means the test is
 * ordered episodically rather than on a schedule.
 */
export const LAB_TESTS = [
  { loinc: '4548-4', name: 'Haemoglobin A1c', panel: 'Diabetes', unit: '%', refLow: 4.0, refHigh: 5.7, repeatInterval: 90, criticalHigh: 10.0 },
  { loinc: '2345-7', name: 'Glucose, fasting', panel: 'Diabetes', unit: 'mmol/L', refLow: 3.9, refHigh: 5.5, repeatInterval: 90, criticalHigh: 16.0 },
  { loinc: '2093-3', name: 'Cholesterol, total', panel: 'Lipids', unit: 'mmol/L', refLow: 3.0, refHigh: 5.2, repeatInterval: 180, criticalHigh: 9.0 },
  { loinc: '2085-9', name: 'HDL Cholesterol', panel: 'Lipids', unit: 'mmol/L', refLow: 1.0, refHigh: 2.2, repeatInterval: 180, criticalHigh: null },
  { loinc: '2571-8', name: 'Triglycerides', panel: 'Lipids', unit: 'mmol/L', refLow: 0.5, refHigh: 1.7, repeatInterval: 180, criticalHigh: 11.0 },
  { loinc: '2160-0', name: 'Creatinine, serum', panel: 'Renal', unit: 'µmol/L', refLow: 60, refHigh: 110, repeatInterval: 120, criticalHigh: 400 },
  { loinc: '33914-3', name: 'eGFR', panel: 'Renal', unit: 'mL/min', refLow: 90, refHigh: 140, repeatInterval: 120, criticalHigh: null },
  { loinc: '3094-0', name: 'Urea nitrogen', panel: 'Renal', unit: 'mmol/L', refLow: 2.5, refHigh: 7.1, repeatInterval: 120, criticalHigh: 30 },
  { loinc: '1742-6', name: 'ALT', panel: 'Hepatic', unit: 'U/L', refLow: 7, refHigh: 56, repeatInterval: 120, criticalHigh: 400 },
  { loinc: '1920-8', name: 'AST', panel: 'Hepatic', unit: 'U/L', refLow: 10, refHigh: 40, repeatInterval: 120, criticalHigh: 400 },
  { loinc: '718-7', name: 'Haemoglobin', panel: 'Haematology', unit: 'g/dL', refLow: 12.0, refHigh: 16.5, repeatInterval: null, criticalHigh: null, criticalLow: 7.0 },
  { loinc: '6690-2', name: 'White cell count', panel: 'Haematology', unit: '10^9/L', refLow: 4.0, refHigh: 11.0, repeatInterval: null, criticalHigh: 30 },
  { loinc: '777-3', name: 'Platelet count', panel: 'Haematology', unit: '10^9/L', refLow: 150, refHigh: 400, repeatInterval: null, criticalHigh: null, criticalLow: 50 },
  { loinc: '3016-3', name: 'TSH', panel: 'Endocrine', unit: 'mIU/L', refLow: 0.4, refHigh: 4.0, repeatInterval: 180, criticalHigh: 40 },
  { loinc: '2857-1', name: 'PSA', panel: 'Tumour markers', unit: 'ng/mL', refLow: 0, refHigh: 4.0, repeatInterval: 365, criticalHigh: 50 },
  { loinc: '5902-2', name: 'Prothrombin time (INR)', panel: 'Coagulation', unit: 'ratio', refLow: 0.8, refHigh: 1.2, repeatInterval: 30, criticalHigh: 5.0 },
  { loinc: '14957-5', name: 'Urine albumin', panel: 'Renal', unit: 'mg/L', refLow: 0, refHigh: 20, repeatInterval: 180, criticalHigh: null },
  { loinc: '2951-2', name: 'Sodium', panel: 'Electrolytes', unit: 'mmol/L', refLow: 135, refHigh: 145, repeatInterval: null, criticalHigh: 160, criticalLow: 120 },
  { loinc: '2823-3', name: 'Potassium', panel: 'Electrolytes', unit: 'mmol/L', refLow: 3.5, refHigh: 5.1, repeatInterval: null, criticalHigh: 6.5, criticalLow: 2.5 },
  { loinc: '1988-5', name: 'C-reactive protein', panel: 'Inflammation', unit: 'mg/L', refLow: 0, refHigh: 5, repeatInterval: null, criticalHigh: 200 },
]

export const MEDICATIONS = [
  { code: 'MET500', name: 'Metformin', form: 'Tablet', strength: '500 mg', atc: 'A10BA02', chronic: true, monitoring: true, monitoringLoinc: '4548-4', highRisk: false, price: 0.45 },
  { code: 'GLIC80', name: 'Gliclazide', form: 'Tablet', strength: '80 mg', atc: 'A10BB09', chronic: true, monitoring: true, monitoringLoinc: '4548-4', highRisk: false, price: 0.7 },
  { code: 'INSGL', name: 'Insulin glargine', form: 'Injection', strength: '100 U/mL', atc: 'A10AE04', chronic: true, monitoring: true, monitoringLoinc: '4548-4', highRisk: true, price: 42 },
  { code: 'AMLO5', name: 'Amlodipine', form: 'Tablet', strength: '5 mg', atc: 'C08CA01', chronic: true, monitoring: false, monitoringLoinc: null, highRisk: false, price: 0.35 },
  { code: 'LISI10', name: 'Lisinopril', form: 'Tablet', strength: '10 mg', atc: 'C09AA03', chronic: true, monitoring: true, monitoringLoinc: '2160-0', highRisk: false, price: 0.4 },
  { code: 'BISO5', name: 'Bisoprolol', form: 'Tablet', strength: '5 mg', atc: 'C07AB07', chronic: true, monitoring: false, monitoringLoinc: null, highRisk: false, price: 0.5 },
  { code: 'ATOR20', name: 'Atorvastatin', form: 'Tablet', strength: '20 mg', atc: 'C10AA05', chronic: true, monitoring: true, monitoringLoinc: '1742-6', highRisk: false, price: 0.6 },
  { code: 'ROSU10', name: 'Rosuvastatin', form: 'Tablet', strength: '10 mg', atc: 'C10AA07', chronic: true, monitoring: true, monitoringLoinc: '1742-6', highRisk: false, price: 0.9 },
  { code: 'WARF5', name: 'Warfarin', form: 'Tablet', strength: '5 mg', atc: 'B01AA03', chronic: true, monitoring: true, monitoringLoinc: '5902-2', highRisk: true, price: 0.3 },
  { code: 'APIX5', name: 'Apixaban', form: 'Tablet', strength: '5 mg', atc: 'B01AF02', chronic: true, monitoring: true, monitoringLoinc: '2160-0', highRisk: true, price: 6.5 },
  { code: 'LEVO50', name: 'Levothyroxine', form: 'Tablet', strength: '50 mcg', atc: 'H03AA01', chronic: true, monitoring: true, monitoringLoinc: '3016-3', highRisk: false, price: 0.25 },
  { code: 'OMEP20', name: 'Omeprazole', form: 'Capsule', strength: '20 mg', atc: 'A02BC01', chronic: true, monitoring: false, monitoringLoinc: null, highRisk: false, price: 0.5 },
  { code: 'SALB', name: 'Salbutamol inhaler', form: 'Inhaler', strength: '100 mcg', atc: 'R03AC02', chronic: true, monitoring: false, monitoringLoinc: null, highRisk: false, price: 18 },
  { code: 'BUDE', name: 'Budesonide/Formoterol', form: 'Inhaler', strength: '160/4.5', atc: 'R03AK07', chronic: true, monitoring: false, monitoringLoinc: null, highRisk: false, price: 62 },
  { code: 'METH25', name: 'Methotrexate', form: 'Tablet', strength: '2.5 mg', atc: 'L04AX03', chronic: true, monitoring: true, monitoringLoinc: '1742-6', highRisk: true, price: 1.2 },
  { code: 'ALLO300', name: 'Allopurinol', form: 'Tablet', strength: '300 mg', atc: 'M04AA01', chronic: true, monitoring: true, monitoringLoinc: '2160-0', highRisk: false, price: 0.4 },
  { code: 'FURO40', name: 'Furosemide', form: 'Tablet', strength: '40 mg', atc: 'C03CA01', chronic: true, monitoring: true, monitoringLoinc: '2823-3', highRisk: false, price: 0.3 },
  { code: 'TAMS04', name: 'Tamsulosin', form: 'Capsule', strength: '0.4 mg', atc: 'G04CA02', chronic: true, monitoring: false, monitoringLoinc: null, highRisk: false, price: 1.1 },
  { code: 'AMOX500', name: 'Amoxicillin', form: 'Capsule', strength: '500 mg', atc: 'J01CA04', chronic: false, monitoring: false, monitoringLoinc: null, highRisk: false, price: 0.35 },
  { code: 'AZIT250', name: 'Azithromycin', form: 'Tablet', strength: '250 mg', atc: 'J01FA10', chronic: false, monitoring: false, monitoringLoinc: null, highRisk: false, price: 2.1 },
  { code: 'PRED5', name: 'Prednisolone', form: 'Tablet', strength: '5 mg', atc: 'H02AB06', chronic: false, monitoring: false, monitoringLoinc: null, highRisk: false, price: 0.3 },
  { code: 'IRON', name: 'Ferrous sulfate', form: 'Tablet', strength: '200 mg', atc: 'B03AA07', chronic: false, monitoring: true, monitoringLoinc: '718-7', highRisk: false, price: 0.2 },
]

export const DIAGNOSES = [
  { icd10: 'E11.9', description: 'Type 2 diabetes mellitus without complications', chronic: true, specialty: 'ENDO' },
  { icd10: 'E11.65', description: 'Type 2 diabetes with hyperglycaemia', chronic: true, specialty: 'ENDO' },
  { icd10: 'I10', description: 'Essential hypertension', chronic: true, specialty: 'CARD' },
  { icd10: 'I25.10', description: 'Atherosclerotic heart disease', chronic: true, specialty: 'CARD' },
  { icd10: 'I50.9', description: 'Heart failure, unspecified', chronic: true, specialty: 'CARD' },
  { icd10: 'I48.91', description: 'Atrial fibrillation, unspecified', chronic: true, specialty: 'CARD' },
  { icd10: 'E78.5', description: 'Hyperlipidaemia, unspecified', chronic: true, specialty: 'CARD' },
  { icd10: 'N18.3', description: 'Chronic kidney disease, stage 3', chronic: true, specialty: 'NEPH' },
  { icd10: 'J44.9', description: 'Chronic obstructive pulmonary disease', chronic: true, specialty: 'PULM' },
  { icd10: 'J45.909', description: 'Asthma, unspecified, uncomplicated', chronic: true, specialty: 'PULM' },
  { icd10: 'E03.9', description: 'Hypothyroidism, unspecified', chronic: true, specialty: 'ENDO' },
  { icd10: 'M06.9', description: 'Rheumatoid arthritis, unspecified', chronic: true, specialty: 'ORTH' },
  { icd10: 'M17.0', description: 'Primary osteoarthritis of knee, bilateral', chronic: true, specialty: 'ORTH' },
  { icd10: 'K21.9', description: 'Gastro-oesophageal reflux disease', chronic: true, specialty: 'GAST' },
  { icd10: 'N40.0', description: 'Benign prostatic hyperplasia', chronic: true, specialty: 'UROL' },
  { icd10: 'G43.909', description: 'Migraine, unspecified', chronic: true, specialty: 'NEUR' },
  { icd10: 'C50.919', description: 'Malignant neoplasm of breast, unspecified', chronic: true, specialty: 'ONCO' },
  { icd10: 'C18.9', description: 'Malignant neoplasm of colon, unspecified', chronic: true, specialty: 'ONCO' },
  { icd10: 'H25.9', description: 'Age-related cataract, unspecified', chronic: false, specialty: 'OPHT' },
  { icd10: 'K80.20', description: 'Calculus of gallbladder without cholecystitis', chronic: false, specialty: 'GSUR' },
  { icd10: 'K35.80', description: 'Acute appendicitis, unspecified', chronic: false, specialty: 'GSUR' },
  { icd10: 'N20.0', description: 'Calculus of kidney', chronic: false, specialty: 'UROL' },
  { icd10: 'J06.9', description: 'Acute upper respiratory infection', chronic: false, specialty: 'FMED' },
  { icd10: 'L20.9', description: 'Atopic dermatitis, unspecified', chronic: false, specialty: 'DERM' },
  { icd10: 'O80', description: 'Encounter for full-term uncomplicated delivery', chronic: false, specialty: 'OBGY' },
  { icd10: 'S82.001A', description: 'Fracture of patella, initial encounter', chronic: false, specialty: 'ORTH' },
]

export const SURGERIES = [
  { cpt: '33533', description: 'Coronary artery bypass graft', specialty: 'CTS', value: 78000, urgencyMix: 0.35 },
  { cpt: '92928', description: 'Percutaneous coronary intervention with stent', specialty: 'CARD', value: 42000, urgencyMix: 0.4 },
  { cpt: '27447', description: 'Total knee arthroplasty', specialty: 'ORTH', value: 48000, urgencyMix: 0.05 },
  { cpt: '27130', description: 'Total hip arthroplasty', specialty: 'ORTH', value: 52000, urgencyMix: 0.08 },
  { cpt: '29881', description: 'Knee arthroscopy with meniscectomy', specialty: 'ORTH', value: 16000, urgencyMix: 0.05 },
  { cpt: '47562', description: 'Laparoscopic cholecystectomy', specialty: 'GSUR', value: 22000, urgencyMix: 0.2 },
  { cpt: '44970', description: 'Laparoscopic appendicectomy', specialty: 'GSUR', value: 18500, urgencyMix: 0.85 },
  { cpt: '49505', description: 'Open inguinal hernia repair', specialty: 'GSUR', value: 14000, urgencyMix: 0.06 },
  { cpt: '66984', description: 'Cataract extraction with lens insertion', specialty: 'OPHT', value: 9500, urgencyMix: 0.02 },
  { cpt: '52332', description: 'Cystoscopy with ureteral stent placement', specialty: 'UROL', value: 12500, urgencyMix: 0.3 },
  { cpt: '52601', description: 'Transurethral resection of prostate', specialty: 'UROL', value: 26000, urgencyMix: 0.08 },
  { cpt: '58571', description: 'Laparoscopic total hysterectomy', specialty: 'OBGY', value: 31000, urgencyMix: 0.1 },
  { cpt: '19307', description: 'Modified radical mastectomy', specialty: 'ONCO', value: 46000, urgencyMix: 0.55 },
  { cpt: '43239', description: 'Upper gastrointestinal endoscopy with biopsy', specialty: 'GAST', value: 7800, urgencyMix: 0.15 },
  { cpt: '45380', description: 'Colonoscopy with biopsy', specialty: 'GAST', value: 8900, urgencyMix: 0.12 },
]

export const CLAIM_SERVICES = [
  { code: '99213', description: 'Outpatient consultation, established patient', amount: 320 },
  { code: '99214', description: 'Outpatient consultation, moderate complexity', amount: 480 },
  { code: '99285', description: 'Emergency department visit, high complexity', amount: 1850 },
  { code: '80053', description: 'Comprehensive metabolic panel', amount: 240 },
  { code: '85025', description: 'Complete blood count with differential', amount: 180 },
  { code: '83036', description: 'Haemoglobin A1c', amount: 165 },
  { code: '71046', description: 'Chest radiograph, two views', amount: 290 },
  { code: '70553', description: 'MRI brain with and without contrast', amount: 3400 },
  { code: '74177', description: 'CT abdomen and pelvis with contrast', amount: 2450 },
  { code: '93306', description: 'Transthoracic echocardiography, complete', amount: 1250 },
  { code: '93000', description: 'Electrocardiogram with interpretation', amount: 210 },
  { code: '45380', description: 'Colonoscopy with biopsy', amount: 8900 },
  { code: '47562', description: 'Laparoscopic cholecystectomy', amount: 22000 },
  { code: '66984', description: 'Cataract extraction with lens insertion', amount: 9500 },
  { code: '27447', description: 'Total knee arthroplasty', amount: 48000 },
]

/**
 * Rejection reasons with their recovery playbook.
 *
 * `recoveryRate` is the historical share recovered when the pathway is worked —
 * it drives both the recoverable-amount figure and the conversion-probability
 * factor for insurance opportunities. `appealable: false` means the payer route
 * is closed and the opportunity becomes a patient financial pathway instead.
 */
export const REJECTION_PLAYBOOK = [
  { code: 'CODING', text: 'Procedure code inconsistent with diagnosis', pathway: 'CORRECT_CODING', recoveryRate: 0.72, appealable: true, department: 'Health Information Management', weight: 18 },
  { code: 'MISSING_DOCUMENTATION', text: 'Supporting clinical documentation not supplied', pathway: 'OBTAIN_DOCUMENTATION', recoveryRate: 0.68, appealable: true, department: 'Medical Records', weight: 16 },
  { code: 'PRIOR_AUTH', text: 'Prior authorisation not obtained before service', pathway: 'APPEAL', recoveryRate: 0.41, appealable: true, department: 'Pre-Authorisation', weight: 14 },
  { code: 'ELIGIBILITY', text: 'Member not eligible on the date of service', pathway: 'RESUBMIT', recoveryRate: 0.35, appealable: true, department: 'Patient Registration', weight: 12 },
  { code: 'MEDICAL_NECESSITY', text: 'Medical necessity not established', pathway: 'APPEAL', recoveryRate: 0.38, appealable: true, department: 'Clinical Documentation', weight: 11 },
  { code: 'BUNDLING', text: 'Service bundled into primary procedure', pathway: 'CORRECT_CODING', recoveryRate: 0.45, appealable: true, department: 'Health Information Management', weight: 8 },
  { code: 'DUPLICATE', text: 'Duplicate of a previously adjudicated claim', pathway: 'RESUBMIT', recoveryRate: 0.22, appealable: true, department: 'Billing', weight: 7 },
  { code: 'UNDERPAID', text: 'Paid below the contracted rate', pathway: 'APPEAL', recoveryRate: 0.58, appealable: true, department: 'Contracts', weight: 5 },
  { code: 'SERVICE_NOT_COVERED', text: 'Service excluded under the member policy', pathway: 'PATIENT_RESPONSIBILITY', recoveryRate: 0.08, appealable: false, department: 'Financial Counselling', weight: 6 },
  { code: 'TIMELY_FILING', text: 'Claim submitted after the filing deadline', pathway: 'WRITE_OFF', recoveryRate: 0.05, appealable: false, department: 'Billing', weight: 3 },
]

export const CHIEF_COMPLAINTS = [
  'Routine chronic disease review', 'Chest pain on exertion', 'Shortness of breath',
  'Uncontrolled blood glucose', 'Follow-up of laboratory results', 'Abdominal pain',
  'Joint pain and stiffness', 'Headache', 'Persistent cough', 'Hypertension review',
  'Pre-operative assessment', 'Post-operative review', 'Medication review',
  'Fatigue and weight loss', 'Dizziness',
]

export const CANCEL_REASONS = [
  'Patient travelling', 'Work commitment', 'Transport difficulty', 'Feeling better',
  'Cost concern', 'Rescheduled by patient', 'Family emergency',
]

export const EXTERNAL_PROVIDERS = [
  'Al Mawaddah Diagnostics', 'Nahdi Imaging Centre', 'Gulf Advanced Labs',
  'Saudi German Hospital', 'Dallah Medical Complex', 'Al Hammadi Hospital',
]

/** Demo users. One per role so every persona in the spec can be signed into. */
export const DEMO_USERS = [
  { email: 'ceo@opportuna.health', name: 'Abdulaziz Al-Rashid', title: 'Group Chief Executive Officer', role: 'GROUP_CEO', hospital: null },
  { email: 'coo@opportuna.health', name: 'Hind Al-Sudairy', title: 'Group Chief Operating Officer', role: 'GROUP_COO', hospital: null },
  { email: 'cmo@opportuna.health', name: 'Dr. Tariq Al-Mansour', title: 'Group Chief Medical Officer', role: 'GROUP_CMO', hospital: null },
  { email: 'gd.riyadh@opportuna.health', name: 'Faisal Al-Dosari', title: 'General Director, Riyadh Central', role: 'GENERAL_DIRECTOR', hospital: 'RYD' },
  { email: 'gd.jeddah@opportuna.health', name: 'Noura Al-Zahrani', title: 'General Director, Jeddah Coastal', role: 'GENERAL_DIRECTOR', hospital: 'JED' },
  { email: 'ed.riyadh@opportuna.health', name: 'Majed Al-Otaibi', title: 'Executive Director, Riyadh Central', role: 'EXECUTIVE_DIRECTOR', hospital: 'RYD' },
  { email: 'dept.riyadh@opportuna.health', name: 'Dr. Layla Al-Harbi', title: 'Head of Outpatient Services', role: 'DEPARTMENT_MANAGER', hospital: 'RYD' },
  { email: 'navigator@opportuna.health', name: 'Reem Al-Ghamdi', title: 'Senior Care Navigator', role: 'CARE_NAVIGATOR', hospital: 'RYD' },
  { email: 'rcm@opportuna.health', name: 'Omar Al-Shehri', title: 'Revenue Cycle Specialist', role: 'RCM_SPECIALIST', hospital: 'RYD' },
  { email: 'analyst@opportuna.health', name: 'Yousef Al-Amri', title: 'Group Data Analyst', role: 'DATA_ANALYST', hospital: null },
  { email: 'admin@opportuna.health', name: 'Sara Al-Qahtani', title: 'Platform Administrator', role: 'PLATFORM_ADMIN', hospital: null },
  { email: 'auditor@opportuna.health', name: 'Khalid Al-Subaie', title: 'Group Compliance Auditor', role: 'AUDITOR', hospital: null },
]

export const DEMO_PASSWORD = 'Demo!Pass123'

export const ALERT_RULES = [
  { name: 'Insurance rejection value rising', metric: 'INSURANCE_REJECTED_VALUE_WOW_PCT', comparator: 'GT', threshold: 15, window: 'WEEK', scope: 'GROUP', severity: 'WARNING', audience: 'GROUP_CEO,GROUP_COO,GENERAL_DIRECTOR' },
  { name: 'Clinical follow-up backlog growing', metric: 'CLINICAL_OPEN_COUNT_WOW_PCT', comparator: 'GT', threshold: 20, window: 'WEEK', scope: 'HOSPITAL', severity: 'WARNING', audience: 'GROUP_CMO,GENERAL_DIRECTOR' },
  { name: 'Unconverted opportunity backlog', metric: 'OPEN_OPPORTUNITY_COUNT', comparator: 'GT', threshold: 300, window: 'DAY', scope: 'HOSPITAL', severity: 'WARNING', audience: 'GROUP_COO,GENERAL_DIRECTOR' },
  { name: 'Surgical consultations not converting', metric: 'SURGERY_UNCONVERTED_COUNT', comparator: 'GT', threshold: 100, window: 'DAY', scope: 'GROUP', severity: 'CRITICAL', audience: 'GROUP_CEO,GROUP_CMO' },
  { name: 'Pharmacy refill abandonment', metric: 'MEDICATION_ABANDONED_COUNT', comparator: 'GT', threshold: 120, window: 'DAY', scope: 'GROUP', severity: 'WARNING', audience: 'GROUP_CMO,GROUP_COO' },
  { name: 'SLA breach rate', metric: 'SLA_BREACH_PCT', comparator: 'GT', threshold: 25, window: 'DAY', scope: 'HOSPITAL', severity: 'CRITICAL', audience: 'GENERAL_DIRECTOR,GROUP_COO' },
  { name: 'Critical clinical opportunities unassigned', metric: 'CRITICAL_UNASSIGNED_COUNT', comparator: 'GT', threshold: 5, window: 'DAY', scope: 'HOSPITAL', severity: 'CRITICAL', audience: 'GROUP_CMO,GENERAL_DIRECTOR' },
]
