import { createPatientProfileSchema } from "./shared/patientProfile.ts";

export default createPatientProfileSchema({
  firstName: "Jordan",
  lastName: "Lee",
  dob: "1992-11-03",
  phone: "555-0122",
});
