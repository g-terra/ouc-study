import { useEffect, type ReactNode } from "react";
import { RouterProvider, Routes, useRouter, enc } from "./lib/router";
import { DataProvider, Loading, Problem, currentSemesterId, useIndex, useSemester } from "./lib/data";
import { Layout } from "./components/Layout";
import { AssistantPanel, AssistantProvider } from "./components/Assistant";
import { Dashboard } from "./pages/Dashboard";
import { Timeline } from "./pages/Timeline";
import { CoursePage, Courses } from "./pages/Courses";
import { NotePage, NotesIndex } from "./pages/Notes";
import { AssignmentPage, AssignmentsPage } from "./pages/Assignments";
import { UpdatesPage } from "./pages/Updates";
import { AiWorkPage } from "./pages/AiWork";
import type { SemesterData } from "@ouc/content/types";

function Semester({ sem, page }: { sem: string; page: (d: SemesterData) => ReactNode }) {
  const data = useSemester(sem);
  useEffect(() => { document.title = data ? `${data.label} · OUC Study` : "OUC Study"; }, [data]);
  return (
    <Layout sem={sem}>
      {data === undefined ? <Loading /> : data === null ? <Problem msg={`No data for semester “${sem}”.`} /> : page(data)}
      {data && <AssistantPanel data={data} />}
    </Layout>
  );
}

function Home() {
  const index = useIndex();
  const { navigate } = useRouter();
  const id = currentSemesterId(index);
  useEffect(() => { if (id) navigate(`/${enc(id)}`); }, [id]);
  return id ? <Loading /> : <Problem msg="No semesters found. Add one under semesters/ (see README)." />;
}

export default function App() {
  return (
    <RouterProvider>
      <DataProvider>
        <AssistantProvider>
          <Routes
            routes={[
              ["/", () => <Home />],
              ["/:sem", (p) => <Semester sem={p.sem} page={(d) => <Dashboard data={d} />} />],
              ["/:sem/timeline", (p) => <Semester sem={p.sem} page={(d) => <Timeline data={d} />} />],
              ["/:sem/courses", (p) => <Semester sem={p.sem} page={(d) => <Courses data={d} />} />],
              ["/:sem/courses/:code", (p) => <Semester sem={p.sem} page={(d) => <CoursePage data={d} code={p.code} />} />],
              ["/:sem/notes", (p) => <Semester sem={p.sem} page={(d) => <NotesIndex data={d} />} />],
              ["/:sem/notes/:code/:slug", (p) => <Semester sem={p.sem} page={(d) => <NotePage key={p.slug} data={d} code={p.code} slug={p.slug} />} />],
              ["/:sem/ai-work", (p) => <Semester sem={p.sem} page={(d) => <AiWorkPage data={d} />} />],
              ["/:sem/updates", (p) => <Semester sem={p.sem} page={(d) => <UpdatesPage data={d} />} />],
              ["/:sem/assignments", (p) => <Semester sem={p.sem} page={(d) => <AssignmentsPage data={d} />} />],
              ["/:sem/assignments/:code/:folder", (p) => <Semester sem={p.sem} page={(d) => <AssignmentPage key={p.folder} data={d} id={`${p.code}/${p.folder}`} />} />],
            ]}
            fallback={<Problem msg="Page not found." />}
          />
        </AssistantProvider>
      </DataProvider>
    </RouterProvider>
  );
}
