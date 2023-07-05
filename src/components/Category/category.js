const data = [
    {
        image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQCVTYk5c4imnAbNwo09unM8ePPtfmHtsk8w&usqp=CAU",
        name: "Fruits"
    },
    {
        image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSKUmZoW6zmIoD8EXAP9JoyaqUrwp1erLP2fQ&usqp=CAU",
        name: "Vegetables"
    },
    {
        image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT58_6Sc-ELMUKOXDBfoD3pk66ywuJIm6TzQg&usqp=CAU",
        name: "Flowers"
    },

]

export const Category = () => {
    return (
        <div className="flex justify-center flex-col mb-40">
            <div className="mb-12 font-mono ml-2 text-xl font-medium mt-10 text-center">CATEGORY</div>
            <div className="flex justify-center">
            {
                data.map((item, index) => {
                    return (
                        <div className="flex flex-col rounded-2xl h-64 mr-20 bg-slate-100 w-72">
                            <img className="rounded-2xl" src={item.image} width={300} height={300} alt={item.name} />
                            <span className="font-mono text-center mt-5">{item.name}</span>
                        </div>
                    )
                })
            }
            </div>
        </div>
    )
}