export function GradeRunsHeader(props: { count: number }) {
  return (
    <div className="flex-column gap-4">
      <div className="flex-row items-center gap-8">
        <strong>Grader runs</strong>
        <span className="secondary-note">({props.count})</span>
      </div>
    </div>
  );
}

export default GradeRunsHeader;
