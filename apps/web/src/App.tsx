import { useEffect, type ReactNode } from "react";
import { RouterProvider, Routes, setLinkRewrite, useRouter, enc } from "./lib/router";
import { DataProvider, Loading, Problem, currentSemesterId, useIndex, useSemester } from "./lib/data";
import { Layout } from "./components/Layout";
import { AssistantPanel, AssistantProvider, ChatPage } from "./components/Assistant";
import { Dashboard } from "./pages/Dashboard";
import { Timeline } from "./pages/Timeline";
import { CoursePage, Courses } from "./pages/Courses";
import { NotePage, NotesIndex } from "./pages/Notes";
import { AssignmentPage, AssignmentsPage } from "./pages/Assignments";
import { UpdatesPage } from "./pages/Updates";
import { PlanPage } from "./pages/Plan";
import { AiWorkPage } from "./pages/AiWork";
import { QuizPage, QuizzesPage } from "./pages/Quizzes";
import { SlidesPage } from "./pages/Slides";
import { VideoPage } from "./pages/Video";
import { Shell } from "./v2/Shell";
import { preferredLook } from "./v2/look";
import { Today } from "./v2/Today";
import { CourseList, CourseView } from "./v2/Courses";
import { Calendar } from "./v2/Calendar";
import { NotificationsPage } from "./v2/Notifications";
import { SettingsPage } from "./v2/Settings";
import { isV2, toV2 } from "./v2/paths";
import type { SemesterData } from "@ouc/content/types";

// while a v2 page is open, links to classic pages open their v2 version
setLinkRewrite((to) => (isV2(window.location.pathname) ? toV2(to) : to));

function Semester({ sem, page }: { sem: string; page: (d: SemesterData) => ReactNode }) {
  const data = useSemester(sem);
  const { path, navigate } = useRouter();
  // the new look is the default: a classic address opens the same page there, unless the classic look was chosen
  const v2 = preferredLook() === "v2";
  useEffect(() => { if (v2) navigate(toV2(path), { raw: true, replace: true }); }, [v2, path]);
  useEffect(() => { document.title = data ? `${data.label} · OUC Study` : "OUC Study"; }, [data]);
  if (v2) return <Loading />;
  return (
    <Layout sem={sem}>
      {data === undefined ? <Loading /> : data === null ? <Problem msg={`No data for semester “${sem}”.`} /> : page(data)}
      {data && <AssistantPanel data={data} />}
    </Layout>
  );
}

/** The v2 preview: the same data and detail pages in a simpler frame (src/v2/). */
function V2Semester({ sem, page }: { sem: string; page: (d: SemesterData) => ReactNode }) {
  const data = useSemester(sem);
  useEffect(() => { document.title = data ? `${data.label} · OUC Study` : "OUC Study"; }, [data]);
  return (
    <Shell sem={sem} data={data}>
      {data === undefined ? <Loading /> : data === null ? <Problem msg={`No data for semester “${sem}”.`} /> : page(data)}
      {data && <AssistantPanel data={data} />}
    </Shell>
  );
}

/** "/" (and "/v2"): the current semester, in the look chosen last. */
function Home({ v2 = false }: { v2?: boolean }) {
  const index = useIndex();
  const { navigate } = useRouter();
  const id = currentSemesterId(index);
  useEffect(() => { if (id) navigate(`${v2 || preferredLook() === "v2" ? "/v2" : ""}/${enc(id)}`, { raw: true }); }, [id]);
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
              ["/v2", () => <Home v2 />],
              ["/v2/:sem", (p) => <V2Semester sem={p.sem} page={(d) => <Today data={d} />} />],
              ["/v2/:sem/courses", (p) => <V2Semester sem={p.sem} page={(d) => <CourseList data={d} />} />],
              ["/v2/:sem/courses/:code", (p) => <V2Semester sem={p.sem} page={(d) => <CourseView key={p.code} data={d} code={p.code} />} />],
              ["/v2/:sem/calendar", (p) => <V2Semester sem={p.sem} page={(d) => <Calendar data={d} />} />],
              ["/v2/:sem/notifications", (p) => <V2Semester sem={p.sem} page={(d) => <NotificationsPage data={d} />} />],
              ["/v2/:sem/inbox", (p) => <V2Semester sem={p.sem} page={(d) => <NotificationsPage data={d} />} />], // the old name, for bookmarks
              ["/v2/:sem/settings", (p) => <V2Semester sem={p.sem} page={(d) => <SettingsPage data={d} />} />],
              // detail pages are shared with the classic look
              ["/v2/:sem/plan", (p) => <V2Semester sem={p.sem} page={(d) => <PlanPage data={d} />} />],
              ["/v2/:sem/plan/:week", (p) => <V2Semester sem={p.sem} page={(d) => <PlanPage key={p.week} data={d} week={p.week} />} />],
              ["/v2/:sem/notes/:code/:slug", (p) => <V2Semester sem={p.sem} page={(d) => <NotePage key={p.slug} data={d} code={p.code} slug={p.slug} />} />],
              ["/v2/:sem/quizzes/:code/:name", (p) => <V2Semester sem={p.sem} page={(d) => <QuizPage key={`${p.code}/${p.name}`} data={d} code={p.code} name={p.name} />} />],
              ["/v2/:sem/slides/:file", (p) => <V2Semester sem={p.sem} page={(d) => <SlidesPage key={p.file} data={d} file={p.file} />} />],
              ["/v2/:sem/video/:file", (p) => <V2Semester sem={p.sem} page={(d) => <VideoPage key={p.file} data={d} file={p.file} />} />],
              ["/v2/:sem/chat", (p) => <V2Semester sem={p.sem} page={(d) => <ChatPage data={d} />} />],
              ["/v2/:sem/chat/:id", (p) => <V2Semester sem={p.sem} page={(d) => <ChatPage data={d} id={p.id} />} />],
              ["/v2/:sem/ai-work", (p) => <V2Semester sem={p.sem} page={(d) => <AiWorkPage data={d} />} />],
              ["/v2/:sem/assignments/:code/:folder", (p) => <V2Semester sem={p.sem} page={(d) => <AssignmentPage key={p.folder} data={d} id={`${p.code}/${p.folder}`} />} />],
              ["/:sem", (p) => <Semester sem={p.sem} page={(d) => <Dashboard data={d} />} />],
              ["/:sem/plan", (p) => <Semester sem={p.sem} page={(d) => <PlanPage data={d} />} />],
              ["/:sem/plan/:week", (p) => <Semester sem={p.sem} page={(d) => <PlanPage key={p.week} data={d} week={p.week} />} />],
              ["/:sem/timeline", (p) => <Semester sem={p.sem} page={(d) => <Timeline data={d} />} />],
              ["/:sem/courses", (p) => <Semester sem={p.sem} page={(d) => <Courses data={d} />} />],
              ["/:sem/courses/:code", (p) => <Semester sem={p.sem} page={(d) => <CoursePage data={d} code={p.code} />} />],
              ["/:sem/notes", (p) => <Semester sem={p.sem} page={(d) => <NotesIndex data={d} />} />],
              ["/:sem/notes/:code/:slug", (p) => <Semester sem={p.sem} page={(d) => <NotePage key={p.slug} data={d} code={p.code} slug={p.slug} />} />],
              ["/:sem/quizzes", (p) => <Semester sem={p.sem} page={(d) => <QuizzesPage data={d} />} />],
              ["/:sem/quizzes/:code/:name", (p) => <Semester sem={p.sem} page={(d) => <QuizPage key={`${p.code}/${p.name}`} data={d} code={p.code} name={p.name} />} />],
              ["/:sem/slides/:file", (p) => <Semester sem={p.sem} page={(d) => <SlidesPage key={p.file} data={d} file={p.file} />} />],
              ["/:sem/video/:file", (p) => <Semester sem={p.sem} page={(d) => <VideoPage key={p.file} data={d} file={p.file} />} />],
              ["/:sem/chat", (p) => <Semester sem={p.sem} page={(d) => <ChatPage data={d} />} />],
              ["/:sem/chat/:id", (p) => <Semester sem={p.sem} page={(d) => <ChatPage data={d} id={p.id} />} />],
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
