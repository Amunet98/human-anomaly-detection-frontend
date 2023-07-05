import { TeamInfo } from "../TeamInfo/TeamInfo"

export const Teams = () => {

    const teamData = [
        {
            "avatar": "https://media.licdn.com/dms/image/C4E03AQF-HpwegmZU6A/profile-displayphoto-shrink_400_400/0/1623173066705?e=1694044800&v=beta&t=9t89DOAYXM8pRz3JPGvp5JwqkdsWrFe4pUN6e6IIKHM",
            "title": "Software engineer",
            "name": "Bimesh Poudel",
            "email": "pbimesh98@gmail.com",
            "phone": "+918105268524",
            "github": "https://github.com/Amunet98",
        },
        {
            "avatar": "WhatsApp Image 2023-07-04 at 23.32.50.jpg",
            "title": "Software engineer",
            "name": "Prashanna KC",
            "email": "kcprashanna28@gmail.com",
            "phone": "+917022404514",
            "github": "https://github.com/Prashanna288",
            
        },
   
    ]
    return (
        <div className="mt-3 text-center items-center flex flex-col p-10">
            <span className="mt-5 font-bold  mb-5 font-mono text-3xl">
                ABOUT PROJECT
            </span>
            <span className="mt-8 text-base w-4/5 font-mono">
            Human anomaly detection in surveillance using deep learning techniques is an innovative approach that leverages advanced technology to enhance security and safety measures. In today's rapidly evolving world, traditional surveillance systems often struggle to accurately identify abnormal human behavior, making it difficult to detect potential threats or criminal activities. However, with the integration of deep learning techniques, anomaly detection systems have significantly improved their ability to detect unusual behavior patterns and identify potential risks.</span>
            <span className="mt-14 text-base w-4/5 font-mono" >Deep learning techniques, such as convolutional neural networks (CNNs) and recurrent neural networks (RNNs), are utilized to analyze vast amounts of surveillance data and extract meaningful features. By training these models on large datasets, they can learn to recognize normal human behavior and distinguish it from anomalous activities. This enables the system to flag any behavior that deviates significantly from the learned patterns, such as sudden movements, suspicious interactions, or unauthorized access attempts.</span>
            <span className="mt-14 text-base w-4/5 font-mono" >One of the key advantages of using deep learning for human anomaly detection is its ability to adapt and learn from new data. As the system encounters new scenarios and encounters, it can continuously update its knowledge and improve its accuracy over time. Moreover, deep learning models can handle complex and diverse data, including video feeds from multiple cameras, which enables comprehensive surveillance coverage across different areas.</span>
            <span className="mt-14 text-2xl w-4/5 font-extrabold font-serif">The deployment of human anomaly detection systems using deep learning techniques has numerous applications in various sectors, including public safety, transportation hubs, critical infrastructure, and retail. By effectively identifying abnormal behavior, these systems can help prevent crime, enhance emergency response capabilities, and improve overall security. However, it is crucial to ensure the ethical use of such systems, taking into account privacy concerns and implementing safeguards to protect individuals' rights while maintaining public safety.  </span>
            <div className="mt-10 flex flex-col ">
                <span className=" text-2xl font-bold font-mono mt-11 mb-10">
                    TEAM INFO
                </span>
                <div className="flex justify-evenly">
                    {
                        teamData.map((item, index) => {
                            return (
                                < div className="mb-10 mr-10 flex justify-between">
                                    <TeamInfo key={index} avatar={item.avatar} email={item.email} name={item.name} title={item.title} phone={item.phone} github={item.github} />
                                </div>
                            )
                        })
                    }
                </div>
            </div>
        </div>
    );
}