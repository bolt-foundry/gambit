import { createPatientProfileSchema } from "./shared/patientProfile.ts";

export default createPatientProfileSchema({
  firstName: "Priya",
  lastName: "Shah",
  dob: "1979-02-18",
  phone: "555-0188",
  originalAppointmentDate: "2023-10-10T14:00:00-07:00",
});
