import { TeamInfo } from "../TeamInfo/TeamInfo";

const teamData = [
    {
        title: "Software engineer",
        name: "Bimesh Poudel",
        email: "pbimesh98@gmail.com",
        phone: "+918105268524",
        github: "https://github.com/Amunet98",
    },
    {
        title: "Software engineer",
        name: "Prashanna KC",
        email: "kcprashanna28@gmail.com",
        phone: "+917022404514",
        github: "https://github.com/Prashanna288",
    },
];

const paragraphs = [
    "Human anomaly detection in surveillance using deep learning techniques is an innovative approach that leverages advanced technology to enhance security and safety measures. In today's rapidly evolving world, traditional surveillance systems often struggle to accurately identify abnormal human behavior, making it difficult to detect potential threats or criminal activities. However, with the integration of deep learning techniques, anomaly detection systems have significantly improved their ability to detect unusual behavior patterns and identify potential risks.",
    "Deep learning techniques, such as convolutional neural networks (CNNs) and recurrent neural networks (RNNs), are utilized to analyze vast amounts of surveillance data and extract meaningful features. By training these models on large datasets, they can learn to recognize normal human behavior and distinguish it from anomalous activities. This enables the system to flag any behavior that deviates significantly from the learned patterns, such as sudden movements, suspicious interactions, or unauthorized access attempts.",
    "One of the key advantages of using deep learning for human anomaly detection is its ability to adapt and learn from new data. As the system encounters new scenarios and encounters, it can continuously update its knowledge and improve its accuracy over time. Moreover, deep learning models can handle complex and diverse data, including video feeds from multiple cameras, which enables comprehensive surveillance coverage across different areas.",
];

const closing =
    "The deployment of human anomaly detection systems using deep learning techniques has numerous applications in various sectors, including public safety, transportation hubs, critical infrastructure, and retail. By effectively identifying abnormal behavior, these systems can help prevent crime, enhance emergency response capabilities, and improve overall security. However, it is crucial to ensure the ethical use of such systems, taking into account privacy concerns and implementing safeguards to protect individuals' rights while maintaining public safety.";

export const Teams = () => (
    <div className="page-gutter py-10 sm:py-16">
        <div className="mx-auto max-w-3xl">
            <header className="text-center">
                <span className="section-tag">About project</span>
                <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-head">
                    Human anomaly detection
                </h1>
            </header>

            {/* max-w-prose (65ch), not the page's max-w-3xl: measured at 1440
                the 3xl container ran 94 characters per line, well past the
                65-75 that stays comfortable to read. The page container still
                governs the header and the team cards, which want the width. */}
            <div className="mt-10 space-y-6 max-w-prose mx-auto">
                {paragraphs.map((text) => (
                    <p key={text.slice(0, 32)} className="text-body">
                        {text}
                    </p>
                ))}
            </div>

            <blockquote className="mt-10 max-w-prose mx-auto border-l-2 border-accent pl-5 text-head">
                {closing}
            </blockquote>

            <h2 className="mt-16 mb-8 text-center font-mono text-sm uppercase tracking-widest text-dim">
                Team
            </h2>
            <div className="flex flex-col sm:flex-row flex-wrap justify-center items-stretch gap-5">
                {teamData.map((member) => (
                    <TeamInfo key={member.email} {...member} />
                ))}
            </div>
        </div>
    </div>
);
