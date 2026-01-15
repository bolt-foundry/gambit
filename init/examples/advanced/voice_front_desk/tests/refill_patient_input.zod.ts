import { createPatientProfileSchema } from "./shared/patientProfile.ts";

export default createPatientProfileSchema({
  firstName: "Jordan",
  lastName: "Lee",
  dob: "1991-07-28",
  phone: "555-0149",
  medicationName: "Lisinopril",
  medicationDose: "10 mg",
  pharmacyName: "Downtown Pharmacy",
});
