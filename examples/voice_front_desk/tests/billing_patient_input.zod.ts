import { createPatientProfileSchema } from "./shared/patientProfile.ts";

export default createPatientProfileSchema({
  firstName: "Avery",
  lastName: "Nguyen",
  dob: "1986-04-12",
  phone: "555-0101",
});
